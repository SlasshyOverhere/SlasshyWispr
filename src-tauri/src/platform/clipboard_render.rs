//! Delayed-render clipboard publishing (Windows).
//!
//! Win32 has no notification for "another app read the clipboard" — only for
//! content changes. Publishing the text as a delayed-render placeholder makes
//! the consuming app call back into our window with `WM_RENDERFORMAT`, which is
//! the only genuine consumption signal. The dictation paste path uses it to put
//! the previous clipboard back at the moment the target takes the transcription,
//! instead of sleeping for a fixed guess.
//!
//! That callback also fires for clipboard monitors — Windows clipboard history,
//! cloud sync, manager utilities — which read a changed clipboard within tens of
//! milliseconds. Their read is attributed by asking which process has the
//! clipboard open, and is not mistaken for the paste target's.

use std::time::Duration;

/// How long a paste may take to pull the text before we stop waiting for it.
pub(crate) const CONSUMPTION_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConsumptionOutcome {
    /// The target pulled the text — safe to restore the previous clipboard.
    Consumed,
    /// Another app took the clipboard before anyone pulled our text.
    Superseded,
    /// Nobody pulled it in time; the paste may not have landed.
    TimedOut,
}

/// What the paste path does with the clipboard once the paste is dispatched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ClipboardRestore {
    /// Put the user's previous clipboard back.
    Restore(String),
    /// Keep the transcription on the clipboard as real data.
    KeepTranscription,
    /// Touch nothing — another app owns the clipboard now.
    LeaveAlone,
}

/// A read only counts as consumption when it comes from the app we are pasting
/// into. Clipboard monitors — history, cloud sync, manager utilities — read the
/// clipboard too, and treating their read as consumption would hand the
/// previous clipboard back before the target ever pasted, which is the bug this
/// sequencing exists to avoid.
fn reader_is_paste_target(target_pid: Option<u32>, reader_pid: Option<u32>) -> bool {
    match (target_pid, reader_pid) {
        (Some(target), Some(reader)) => target == reader,
        // Nothing to compare against: any read is the best signal available,
        // and refusing it would mean never restoring at all.
        (None, _) => true,
        // We know the target but not the reader. The text is still delivered, so
        // the paste works either way; claiming this was the paste risks handing
        // the previous clipboard back too early, which pastes the wrong text.
        (Some(_), None) => false,
    }
}

pub(crate) fn restore_action(
    outcome: ConsumptionOutcome,
    previous: Option<&str>,
) -> ClipboardRestore {
    match (outcome, previous) {
        (ConsumptionOutcome::Superseded, _) => ClipboardRestore::LeaveAlone,
        // Restoring only makes sense if we actually captured what was there.
        (ConsumptionOutcome::Consumed, Some(previous)) => {
            ClipboardRestore::Restore(previous.to_string())
        }
        _ => ClipboardRestore::KeepTranscription,
    }
}

#[cfg(target_os = "windows")]
pub(crate) use imp::publish_delayed;

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
    use std::time::{Duration, Instant};

    use log::{debug, warn};
    use windows_sys::Win32::Foundation::{
        GetLastError, GlobalFree, SetLastError, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM,
    };
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardOwner, GetOpenClipboardWindow, OpenClipboard,
        SetClipboardData,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    use super::{reader_is_paste_target, ConsumptionOutcome};

    /// `CF_UNICODETEXT` — declared here to avoid enabling the whole
    /// `Win32_System_Ole` feature for one constant.
    pub(crate) const CF_UNICODETEXT_FORMAT: u32 = 13;

    const WM_APP_PUBLISH: u32 = WM_APP + 1;
    const WM_APP_MATERIALIZE: u32 = WM_APP + 2;

    const WINDOW_CLASS_NAME: &str = "SlasshyWisprClipboardRender";
    const WINDOW_READY_TIMEOUT: Duration = Duration::from_secs(2);

    struct SharedInner {
        text: Option<String>,
        consumed: bool,
        lost_ownership: bool,
        /// Stored as `isize` so the state stays `Send`; 0 means "not created".
        hwnd: isize,
        spawn_error: Option<String>,
        ack: Option<Result<(), String>>,
        target_pid: Option<u32>,
    }

    struct SharedState {
        inner: Mutex<SharedInner>,
        signal: Condvar,
    }

    impl SharedState {
        fn lock(&self) -> MutexGuard<'_, SharedInner> {
            // A panic elsewhere must not wedge every future paste.
            self.inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        }
    }

    /// Let the tests read the clipboard as a real window owner, so a read can be
    /// attributed to this process like a target app's read would be.
    #[cfg(test)]
    pub(crate) fn test_window() -> isize {
        ensure_window().expect("clipboard render window")
    }

    fn state() -> &'static SharedState {
        static STATE: OnceLock<SharedState> = OnceLock::new();
        STATE.get_or_init(|| SharedState {
            inner: Mutex::new(SharedInner {
                text: None,
                consumed: false,
                lost_ownership: false,
                hwnd: 0,
                spawn_error: None,
                ack: None,
                target_pid: None,
            }),
            signal: Condvar::new(),
        })
    }

    /// Token for one published delayed render. Only one paste is ever in flight,
    /// so the backing state is a singleton rather than per-token.
    #[derive(Debug, Clone, Copy)]
    pub(crate) struct ClipboardPublisher {
        _private: (),
    }

    /// Publish `text` as a delayed-render placeholder. Returns once the
    /// clipboard genuinely holds the placeholder, so the caller never needs a
    /// settle sleep before sending the paste keystroke. `paste_target_pid` is
    /// the process the paste is aimed at, used to attribute the read.
    pub(crate) fn publish_delayed(
        text: &str,
        paste_target_pid: Option<u32>,
    ) -> Result<ClipboardPublisher, String> {
        let hwnd = ensure_window()?;
        {
            let mut inner = state().lock();
            inner.text = Some(text.to_string());
            inner.target_pid = paste_target_pid;
        }

        post(hwnd, WM_APP_PUBLISH)?;
        wait_for_ack()?;
        Ok(ClipboardPublisher { _private: () })
    }

    impl ClipboardPublisher {
        /// Block until the target pulls the text, another app takes the
        /// clipboard, or `timeout` elapses.
        pub(crate) fn wait_for_consumption(&self, timeout: Duration) -> ConsumptionOutcome {
            let state = state();
            let deadline = Instant::now() + timeout;
            let mut inner = state.lock();
            loop {
                if inner.consumed {
                    return ConsumptionOutcome::Consumed;
                }
                if inner.lost_ownership {
                    return ConsumptionOutcome::Superseded;
                }
                let now = Instant::now();
                if now >= deadline {
                    return ConsumptionOutcome::TimedOut;
                }
                let (guard, _) = state
                    .signal
                    .wait_timeout(inner, deadline - now)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                inner = guard;
            }
        }

        /// Turn the placeholder into real clipboard data, so the transcription
        /// survives this process exiting and stays available for a manual paste.
        pub(crate) fn materialize(&self) {
            let Ok(hwnd) = ensure_window() else {
                return;
            };
            if let Err(error) = post(hwnd, WM_APP_MATERIALIZE) {
                warn!("[client] clipboard materialize skipped: {error}");
                return;
            }
            if let Err(error) = wait_for_ack() {
                warn!("[client] clipboard materialize failed: {error}");
            }
        }

        /// Drop the delayed render before the caller restores the previous
        /// clipboard, so a late `WM_RENDERFORMAT` cannot overwrite it.
        pub(crate) fn stop_rendering(&self) {
            state().lock().text = None;
        }
    }

    fn post(hwnd: isize, message: u32) -> Result<(), String> {
        let posted = unsafe { PostMessageW(hwnd as HWND, message, 0, 0) };
        if posted == 0 {
            return Err(format!("PostMessageW({message}) failed: {}", unsafe {
                GetLastError()
            }));
        }
        Ok(())
    }

    /// Wait for the window thread to finish the last requested action.
    fn wait_for_ack() -> Result<(), String> {
        let state = state();
        let deadline = Instant::now() + WINDOW_READY_TIMEOUT;
        let mut inner = state.lock();
        loop {
            if let Some(result) = inner.ack.take() {
                return result;
            }
            let now = Instant::now();
            if now >= deadline {
                return Err("Timed out waiting for the clipboard render window".to_string());
            }
            let (guard, _) = state
                .signal
                .wait_timeout(inner, deadline - now)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner = guard;
        }
    }

    fn ensure_window() -> Result<isize, String> {
        let state = state();
        {
            let inner = state.lock();
            if inner.hwnd != 0 {
                return Ok(inner.hwnd);
            }
            if let Some(error) = &inner.spawn_error {
                return Err(error.clone());
            }
        }

        static THREAD: OnceLock<Result<(), String>> = OnceLock::new();
        let spawned = THREAD.get_or_init(|| {
            std::thread::Builder::new()
                .name("clipboard-render".to_string())
                .spawn(window_thread)
                .map(|_| ())
                .map_err(|error| format!("Failed to start the clipboard render thread: {error}"))
        });
        if let Err(error) = spawned {
            return Err(error.clone());
        }

        let deadline = Instant::now() + WINDOW_READY_TIMEOUT;
        let mut inner = state.lock();
        loop {
            if inner.hwnd != 0 {
                return Ok(inner.hwnd);
            }
            if let Some(error) = &inner.spawn_error {
                return Err(error.clone());
            }
            let now = Instant::now();
            if now >= deadline {
                let error = "Timed out creating the clipboard render window".to_string();
                inner.spawn_error = Some(error.clone());
                return Err(error);
            }
            let (guard, _) = state
                .signal
                .wait_timeout(inner, deadline - now)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner = guard;
        }
    }

    /// Owns the message-only window; exits when the window is destroyed.
    fn window_thread() {
        let class_name: Vec<u16> = WINDOW_CLASS_NAME.encode_utf16().chain([0]).collect();
        unsafe {
            let hinstance = GetModuleHandleW(std::ptr::null());
            let window_class = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: hinstance,
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: class_name.as_ptr(),
            };
            if RegisterClassW(&window_class) == 0 {
                report_spawn_error(format!("RegisterClassW failed: {}", GetLastError()));
                return;
            }

            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                class_name.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                report_spawn_error(format!("CreateWindowExW failed: {}", GetLastError()));
                return;
            }

            let state = state();
            {
                let mut inner = state.lock();
                inner.hwnd = hwnd as isize;
                state.signal.notify_all();
            }

            let mut message: MSG = std::mem::zeroed();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    fn report_spawn_error(error: String) {
        warn!("[client] {error}");
        let state = state();
        let mut inner = state.lock();
        inner.spawn_error = Some(error);
        state.signal.notify_all();
    }

    fn store_ack(result: Result<(), String>) {
        let state = state();
        let mut inner = state.lock();
        inner.ack = Some(result);
        state.signal.notify_all();
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            // The requester already has the clipboard open, so rendering here
            // must not call OpenClipboard.
            WM_RENDERFORMAT => {
                render(wparam as u32);
                0
            }
            WM_RENDERALLFORMATS => {
                if OpenClipboard(hwnd) != 0 {
                    // Another app may have taken the clipboard while we were
                    // being asked to render; check after opening, not before.
                    if GetClipboardOwner() == hwnd {
                        render(CF_UNICODETEXT_FORMAT);
                    }
                    CloseClipboard();
                }
                0
            }
            WM_DESTROYCLIPBOARD => {
                let state = state();
                let mut inner = state.lock();
                inner.lost_ownership = true;
                state.signal.notify_all();
                0
            }
            WM_APP_PUBLISH => {
                store_ack(publish(hwnd));
                0
            }
            WM_APP_MATERIALIZE => {
                store_ack(materialize(hwnd));
                0
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    /// Put the published text on the clipboard that the requester already has
    /// open. Holds the lock throughout so `stop_rendering` cannot interleave.
    fn render(format: u32) {
        if format != CF_UNICODETEXT_FORMAT {
            return;
        }
        let state = state();
        let mut inner = state.lock();
        let Some(text) = inner.text.clone() else {
            return;
        };
        let Some(hglobal) = allocate_utf16(&text) else {
            warn!("[client] clipboard delayed render could not allocate memory");
            return;
        };

        let stored = unsafe { SetClipboardData(format, hglobal) };
        if stored.is_null() {
            unsafe { GlobalFree(hglobal) };
            warn!("[client] clipboard delayed render failed: {}", unsafe {
                GetLastError()
            });
            return;
        }

        // The text is real clipboard data either way, so the paste itself cannot
        // fail. Only the restore decision depends on who did the reading.
        let reader_pid = process_id_of_open_clipboard();
        inner.text = None;
        if reader_is_paste_target(inner.target_pid, reader_pid) {
            inner.consumed = true;
        } else {
            debug!(
                "[client] clipboard read by pid {:?} while pasting into pid {:?}; still waiting",
                reader_pid, inner.target_pid
            );
        }
        state.signal.notify_all();
    }

    /// The process that currently has the clipboard open — during
    /// `WM_RENDERFORMAT` that is whoever is reading, so it identifies the reader.
    fn process_id_of_open_clipboard() -> Option<u32> {
        let hwnd = unsafe { GetOpenClipboardWindow() };
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0u32;
        if unsafe { GetWindowThreadProcessId(hwnd, &mut pid) } == 0 || pid == 0 {
            return None;
        }
        Some(pid)
    }

    /// `OpenClipboard` fails while any other thread or process holds the
    /// clipboard, which happens routinely, so retry briefly instead of aborting
    /// the paste.
    fn open_clipboard(hwnd: HWND) -> Result<(), String> {
        const ATTEMPTS: u32 = 25;
        const BACKOFF: Duration = Duration::from_millis(4);
        let mut last_error = 0;
        for attempt in 0..ATTEMPTS {
            if unsafe { OpenClipboard(hwnd) } != 0 {
                return Ok(());
            }
            last_error = unsafe { GetLastError() };
            if attempt + 1 < ATTEMPTS {
                std::thread::sleep(BACKOFF);
            }
        }
        Err(format!("OpenClipboard failed: {last_error}"))
    }

    fn publish(hwnd: HWND) -> Result<(), String> {
        open_clipboard(hwnd)?;
        unsafe {
            if EmptyClipboard() == 0 {
                let error = GetLastError();
                CloseClipboard();
                return Err(format!("EmptyClipboard failed: {error}"));
            }
            SetLastError(0);
            // A null handle is what requests delayed rendering: the data is
            // handed over when the target asks for it.
            let stored = SetClipboardData(CF_UNICODETEXT_FORMAT, std::ptr::null_mut());
            let error = GetLastError();
            CloseClipboard();
            if stored.is_null() && error != 0 {
                return Err(format!("Delayed-render publish failed: {error}"));
            }
        }

        // Reset after EmptyClipboard: emptying our own placeholder sends us
        // WM_DESTROYCLIPBOARD synchronously, which must not count as a takeover.
        let state = state();
        let mut inner = state.lock();
        inner.consumed = false;
        inner.lost_ownership = false;
        Ok(())
    }

    /// Replace our own placeholder with real data, for when nobody consumed it.
    fn materialize(hwnd: HWND) -> Result<(), String> {
        let text = {
            let inner = state().lock();
            inner.text.clone()
        };
        let Some(text) = text else {
            return Ok(());
        };

        open_clipboard(hwnd)?;
        unsafe {
            let outcome = if GetClipboardOwner() != hwnd {
                Err("clipboard ownership moved on; left it alone".to_string())
            } else {
                match allocate_utf16(&text) {
                    None => Err("could not allocate clipboard memory".to_string()),
                    Some(hglobal) => {
                        let stored = SetClipboardData(CF_UNICODETEXT_FORMAT, hglobal);
                        if stored.is_null() {
                            GlobalFree(hglobal);
                            Err(format!("SetClipboardData failed: {}", GetLastError()))
                        } else {
                            Ok(())
                        }
                    }
                }
            };
            CloseClipboard();
            outcome?;
        }

        state().lock().text = None;
        Ok(())
    }

    fn allocate_utf16(text: &str) -> Option<HGLOBAL> {
        let mut units: Vec<u16> = text.encode_utf16().collect();
        units.push(0);
        let bytes = units.len() * std::mem::size_of::<u16>();
        unsafe {
            let hglobal = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if hglobal.is_null() {
                return None;
            }
            let target = GlobalLock(hglobal) as *mut u16;
            if target.is_null() {
                GlobalFree(hglobal);
                return None;
            }
            std::ptr::copy_nonoverlapping(units.as_ptr(), target, units.len());
            GlobalUnlock(hglobal);
            Some(hglobal)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consumed_with_a_snapshot_restores_it() {
        assert_eq!(
            restore_action(ConsumptionOutcome::Consumed, Some("earlier")),
            ClipboardRestore::Restore("earlier".to_string())
        );
    }

    #[test]
    fn consumed_without_a_snapshot_keeps_the_transcription() {
        // Nothing to restore to, so dropping the text would lose it entirely.
        assert_eq!(
            restore_action(ConsumptionOutcome::Consumed, None),
            ClipboardRestore::KeepTranscription
        );
    }

    #[test]
    fn unconsumed_pastes_keep_the_transcription() {
        assert_eq!(
            restore_action(ConsumptionOutcome::TimedOut, Some("earlier")),
            ClipboardRestore::KeepTranscription
        );
    }

    #[test]
    fn a_read_by_the_paste_target_counts_as_consumption() {
        assert!(reader_is_paste_target(Some(4242), Some(4242)));
    }

    #[test]
    fn a_clipboard_monitors_read_is_not_consumption() {
        // Windows clipboard history reads a changed clipboard almost
        // immediately; treating that as the paste would restore the previous
        // clipboard before the target ever pasted.
        assert!(!reader_is_paste_target(Some(4242), Some(9999)));
        assert!(!reader_is_paste_target(Some(4242), None));
    }

    #[test]
    fn an_unattributable_read_still_counts() {
        // Nothing to compare against; keep waiting instead of stranding the text.
        assert!(reader_is_paste_target(None, Some(4242)));
        assert!(reader_is_paste_target(None, None));
    }

    #[test]
    fn takeover_leaves_the_other_apps_clipboard_alone() {
        assert_eq!(
            restore_action(ConsumptionOutcome::Superseded, Some("earlier")),
            ClipboardRestore::LeaveAlone
        );
        assert_eq!(
            restore_action(ConsumptionOutcome::Superseded, None),
            ClipboardRestore::LeaveAlone
        );
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use std::time::Duration;

    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    use windows_sys::Win32::Foundation::HWND;

    use super::imp::{test_window, CF_UNICODETEXT_FORMAT};
    use super::{publish_delayed, ConsumptionOutcome};

    const SHORT: Duration = Duration::from_millis(150);
    /// A pid no window can belong to, standing in for "not the paste target".
    const NOT_THE_TARGET: u32 = u32::MAX;

    /// Read the clipboard the way a pasting app does, opening it under `owner` so
    /// the read can be attributed to a process. Opening it and asking for the
    /// text is exactly what triggers `WM_RENDERFORMAT` in the owner.
    fn read_clipboard_text(owner: isize) -> Option<String> {
        if !open_clipboard(owner) {
            return None;
        }
        let text = unsafe {
            let handle = GetClipboardData(CF_UNICODETEXT_FORMAT);
            let pointer = if handle.is_null() {
                std::ptr::null()
            } else {
                GlobalLock(handle) as *const u16
            };
            if pointer.is_null() {
                None
            } else {
                let mut length = 0usize;
                while *pointer.add(length) != 0 {
                    length += 1;
                }
                let text = String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length));
                GlobalUnlock(handle);
                Some(text)
            }
        };
        unsafe { CloseClipboard() };
        text
    }

    fn open_clipboard(owner: isize) -> bool {
        for _ in 0..50 {
            if unsafe { OpenClipboard(owner as HWND) } != 0 {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    fn release_clipboard() {
        if open_clipboard(0) {
            unsafe { EmptyClipboard() };
            unsafe { CloseClipboard() };
        }
    }

    /// One test covering the whole round trip: cargo runs tests in parallel and
    /// the clipboard is a single shared OS resource.
    /// One test covering the whole round trip: cargo runs tests in parallel and
    /// the clipboard is a single shared OS resource.
    #[test]
    fn delayed_render_round_trip() {
        // The paste target reading is what delivers the text and lets the caller
        // put the previous clipboard back.
        let target = std::process::id();
        let publisher = publish_delayed("hello from the dictation", Some(target)).expect("publish");
        assert_eq!(
            read_clipboard_text(test_window()).as_deref(),
            Some("hello from the dictation")
        );
        assert_eq!(
            publisher.wait_for_consumption(SHORT),
            ConsumptionOutcome::Consumed
        );

        // A read from anything else must still deliver the text, but must not be
        // mistaken for the paste — that is how a clipboard monitor would make us
        // restore the previous clipboard too early.
        release_clipboard();
        let publisher = publish_delayed("monitored", Some(NOT_THE_TARGET)).expect("publish");
        assert_eq!(
            read_clipboard_text(test_window()).as_deref(),
            Some("monitored")
        );
        assert_eq!(
            publisher.wait_for_consumption(SHORT),
            ConsumptionOutcome::TimedOut
        );

        // Without any read there is no consumption, and materializing must leave
        // the transcription behind as ordinary clipboard data.
        release_clipboard();
        let publisher = publish_delayed("never pulled", Some(target)).expect("publish");
        assert_eq!(
            publisher.wait_for_consumption(SHORT),
            ConsumptionOutcome::TimedOut
        );
        publisher.materialize();
        assert_eq!(read_clipboard_text(0).as_deref(), Some("never pulled"));

        // Someone else copying must be reported rather than waited on, so the
        // paste path cannot restore over their clipboard.
        release_clipboard();
        let publisher = publish_delayed("superseded", Some(target)).expect("publish");
        release_clipboard();
        assert_eq!(
            publisher.wait_for_consumption(Duration::from_secs(5)),
            ConsumptionOutcome::Superseded
        );

        // A stopped render must never put stale text back over whatever the
        // caller restored in its place.
        release_clipboard();
        let publisher = publish_delayed("stale", Some(target)).expect("publish");
        publisher.stop_rendering();
        assert_eq!(read_clipboard_text(test_window()), None);

        release_clipboard();
    }
}
