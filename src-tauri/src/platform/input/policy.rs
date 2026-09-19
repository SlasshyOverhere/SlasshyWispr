//! Foreground-blocking policy (platform input policy).
//!
//! Moved verbatim from commands::input: pure process-name / window-title /
//! fullscreen heuristics. No Win32 calls, no I/O. Tested by the
//! foreground-policy tests below (moved with the code from lib.rs).

pub(crate) fn is_blocked_game_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    let base = normalized.trim_end_matches(".exe");

    // Known IDE/editor process names that start with a game-prefix substring
    // must be exempted before prefix matching to avoid false positives.
    const IDE_EXEMPT: [&str; 4] = ["code", "code - insiders", "cursor", "windsurf"];
    if IDE_EXEMPT.contains(&base) {
        return false;
    }

    const BLOCKED_EXACT: [&str; 35] = [
        "ac_client",
        "apex",
        "bf1",
        "bf2042",
        "bo6",
        "valorant",
        "valorant-win64-shipping",
        "cs2",
        "hl2",
        "dota2",
        "r5apex",
        "fortniteclient-win64-shipping",
        "overwatch",
        "rainbowsix",
        "rocketleague",
        "gta5",
        "eldenring",
        "escapedfromtarkov",
        "eurotrucks2",
        "farlight84",
        "fc25",
        "leagueclientux",
        "leagueclientuxrender",
        "leagueoflegends",
        "minecraft",
        "minecraftlauncher",
        "palworld-win64-shipping",
        "pathofexile",
        "pathofexilesteam",
        "warframe.x64",
        "witcher3",
        "wow",
        "destiny2",
        "pubg",
        "rustclient",
    ];

    if BLOCKED_EXACT.contains(&base) {
        return true;
    }

    const BLOCKED_PREFIXES: [&str; 32] = [
        "arma",
        "assettocorsa",
        "blackops",
        "cod",
        "counter-strike",
        "cyberpunk",
        "valorant",
        "fortniteclient",
        "r5apex",
        "diablo",
        "dragonage",
        "ea sports fc",
        "eafc",
        "elden",
        "fifa",
        "forza",
        "genshin",
        "honkai",
        "leagueclient",
        "leagueoflegends",
        "nba2k",
        "nfs",
        "rainbowsix",
        "rocketleague",
        "overwatch",
        "palworld",
        "destiny2",
        "pubg",
        "rustclient",
        "starrail",
        "tekken",
        "witcher",
    ];

    BLOCKED_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
}

pub(crate) fn is_allowed_fullscreen_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }

    let base = normalized.trim_end_matches(".exe");
    const ALLOWED_FULLSCREEN_EXACT: [&str; 25] = [
        "app",
        "arc",
        "brave",
        "chrome",
        "code",
        "cursor",
        "discord",
        "explorer",
        "firefox",
        "mpc-hc64",
        "msedge",
        "obs64",
        "opera",
        "outlook",
        "photos",
        "potplayermini64",
        "powerpnt",
        "slack",
        "spotify",
        "steam",
        "telegram",
        "teams",
        "vlc",
        "webview2manager",
        "zoom",
    ];
    if ALLOWED_FULLSCREEN_EXACT.contains(&base) {
        return true;
    }

    const ALLOWED_FULLSCREEN_PREFIXES: [&str; 7] = [
        "code - insiders",
        "microsoft",
        "ms-teams",
        "powerpoint",
        "wezterm",
        "windows terminal",
        "windowsterminal",
    ];
    ALLOWED_FULLSCREEN_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
}

pub(crate) fn is_likely_fullscreen_game_window(
    process_name: &str,
    window_title: &str,
    fullscreen: bool,
) -> bool {
    if !fullscreen || is_allowed_fullscreen_process_name(process_name) {
        return false;
    }

    let normalized_title = window_title.trim().to_ascii_lowercase();
    !(normalized_title.contains("youtube")
        || normalized_title.contains("netflix")
        || normalized_title.contains("twitch")
        || normalized_title.contains("prime video")
        || normalized_title.contains("presentation")
        || normalized_title.contains("powerpoint"))
}

pub(crate) fn is_blocked_terminal_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    let base = normalized.trim_end_matches(".exe");
    const BLOCKED_TERMINAL_EXACT: [&str; 11] = [
        "cmd",
        "conhost",
        "powershell",
        "pwsh",
        "windowsterminal",
        "wt",
        "bash",
        "zsh",
        "fish",
        "mintty",
        "tabby",
    ];
    if BLOCKED_TERMINAL_EXACT.contains(&base) {
        return true;
    }

    const BLOCKED_TERMINAL_PREFIXES: [&str; 5] = [
        "windows terminal",
        "wezterm",
        "alacritty",
        "cmder",
        "git-bash",
    ];
    if BLOCKED_TERMINAL_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
    {
        return true;
    }

    base.contains("terminal")
}

pub(crate) fn is_ide_terminal_window(process_name: &str, window_title: &str) -> bool {
    let normalized_process = process_name.trim().to_ascii_lowercase();
    let normalized_title = window_title.trim().to_ascii_lowercase();
    if normalized_process.is_empty() || normalized_title.is_empty() {
        return false;
    }

    let is_ide = normalized_process == "code"
        || normalized_process == "cursor"
        || normalized_process == "code - insiders"
        || normalized_process == "windsurf";
    if !is_ide {
        return false;
    }

    normalized_title.contains("terminal")
        || normalized_title.contains("powershell")
        || normalized_title.contains("pwsh")
        || normalized_title.contains("cmd")
        || normalized_title.contains("bash")
        || normalized_title.contains("zsh")
        || normalized_title.contains("fish")
}

pub(crate) fn foreground_input_block_reason(
    process_name: &str,
    window_title: &str,
    fullscreen: bool,
) -> Option<&'static str> {
    if is_blocked_game_process_name(process_name) {
        return Some("game-process");
    }
    if is_likely_fullscreen_game_window(process_name, window_title, fullscreen) {
        return Some("fullscreen-game-heuristic");
    }
    if is_blocked_terminal_process_name(process_name) {
        return Some("terminal-process");
    }
    if is_ide_terminal_window(process_name, window_title) {
        return Some("ide-terminal");
    }
    None
}

#[cfg(test)]
mod tests {
// ===== FOREGROUND INPUT BLOCKING POLICY =====

#[test]
fn blocks_known_game_processes() {
    assert_eq!(super::foreground_input_block_reason("cs2", "", false), Some("game-process"));
    assert_eq!(super::foreground_input_block_reason("valorant", "", false), Some("game-process"));
    assert_eq!(super::foreground_input_block_reason("fortniteclient-win64-shipping", "", false), Some("game-process"));
    assert_eq!(super::foreground_input_block_reason("gta5", "", false), Some("game-process"));
}

#[test]
fn blocks_game_prefixes() {
    assert_eq!(super::foreground_input_block_reason("cyberpunk2077", "", false), Some("game-process"));
    assert_eq!(super::foreground_input_block_reason("cod_ghosts", "", false), Some("game-process"));
    assert_eq!(super::foreground_input_block_reason("eldenring", "", false), Some("game-process"));
}

#[test]
fn blocks_terminal_processes() {
    assert_eq!(super::foreground_input_block_reason("cmd", "", false), Some("terminal-process"));
    assert_eq!(super::foreground_input_block_reason("powershell", "", false), Some("terminal-process"));
    assert_eq!(super::foreground_input_block_reason("windowsterminal", "", false), Some("terminal-process"));
    assert_eq!(super::foreground_input_block_reason("mintty", "", false), Some("terminal-process"));
}

#[test]
fn blocks_ide_terminal_tabs() {
    assert_eq!(
        super::foreground_input_block_reason("code", "My Project — terminal", false),
        Some("ide-terminal")
    );
    assert_eq!(
        super::foreground_input_block_reason("cursor", "main.rs — PowerShell", false),
        Some("ide-terminal")
    );
}

#[test]
fn does_not_block_normal_processes() {
    assert_eq!(super::foreground_input_block_reason("chrome", "", false), None);
    assert_eq!(super::foreground_input_block_reason("slack", "", false), None);
    assert_eq!(super::foreground_input_block_reason("explorer", "", false), None);
    assert_eq!(super::foreground_input_block_reason("app", "", false), None);
}

#[test]
fn does_not_block_ide_with_non_terminal_tab() {
    assert_eq!(
        super::foreground_input_block_reason("code", "main.rs — Visual Studio Code", false),
        None
    );
}

#[test]
fn blocks_fullscreen_game_heuristic() {
    assert_eq!(
        super::foreground_input_block_reason("unknown_game", "My Game", true),
        Some("fullscreen-game-heuristic")
    );
}

#[test]
fn does_not_block_fullscreen_allowed_processes() {
    assert_eq!(
        super::foreground_input_block_reason("chrome", "YouTube", true),
        None
    );
}

#[test]
fn does_not_block_fullscreen_video_content() {
    assert_eq!(
        super::foreground_input_block_reason("vlc", "youtube.com/video", true),
        None
    );
}

#[test]
fn empty_process_name_not_blocked() {
    assert_eq!(super::foreground_input_block_reason("", "", false), None);
}
}
