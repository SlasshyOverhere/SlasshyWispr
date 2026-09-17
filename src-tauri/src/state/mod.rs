//! Application state modules (Phase 6a).

pub mod app_state;
pub mod window;

pub(crate) use app_state::AppState;
pub use window::{WindowRect, WindowVisibilityState};
pub(crate) use window::TRAY_UPDATE_ITEM;
