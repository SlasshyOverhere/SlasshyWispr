//! Local-STT hardware probing + advice — Phase 7d extraction.
//!
//! Moved verbatim from lib.rs: OS probes (Windows registry + GetSystemInfo +
//! GlobalMemoryStatusEx, Linux /proc, macOS sysctl), NVIDIA nvidia-smi probe,
//! performance-tier classification, per-tier model policy, and
//! `build_local_stt_hardware_advice`. Pure helpers and OS probes stay together
//! here; the command adapter calls `build_local_stt_hardware_advice`.

#[cfg(target_os = "linux")]
use std::fs;
use std::process::{Command, Stdio};

use crate::pipeline::process::apply_no_window;
use crate::pipeline::routing::{
    built_in_local_stt_model_catalog, canonical_local_stt_model_id,
    local_stt_model_display_label, local_stt_model_size_gb, normalize_model_name,
};

#[cfg(target_os = "windows")]
use windows_sys::Win32::System::SystemInformation::{
    GetSystemInfo, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO,
};

#[derive(Debug, Default)]
pub(crate) struct LocalSttHardwareProbe {
    pub(crate) cpu_name: String,
    pub(crate) logical_cores: usize,
    pub(crate) total_ram_bytes: u64,
    pub(crate) nvidia_gpu_detected: bool,
    pub(crate) gpu_name: String,
    pub(crate) gpu_vram_mb: u64,
}

pub(crate) fn round_to_single_decimal(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

pub(crate) fn parse_u64_token(raw: &str) -> Option<u64> {
    let token = raw.trim().split_whitespace().next().unwrap_or_default();
    if token.is_empty() {
        return None;
    }
    let compact = token.replace(',', "");
    compact.parse::<u64>().ok()
}

pub(crate) fn probe_local_stt_hardware() -> LocalSttHardwareProbe {
    let mut probe = LocalSttHardwareProbe::default();
    probe.logical_cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(0);

    #[cfg(target_os = "windows")]
    probe_windows_local_stt_hardware(&mut probe);

    #[cfg(target_os = "linux")]
    probe_linux_local_stt_hardware(&mut probe);

    #[cfg(target_os = "macos")]
    probe_macos_local_stt_hardware(&mut probe);

    probe_nvidia_gpu_for_local_stt(&mut probe);
    probe
}

#[cfg(target_os = "windows")]
pub(crate) fn probe_windows_local_stt_hardware(probe: &mut LocalSttHardwareProbe) {
    use winreg::enums::*;
    use winreg::RegKey;

    // CPU name from registry
    if let Ok(hklm) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", KEY_READ)
    {
        if let Ok(name) = hklm.get_value::<String, _>("ProcessorNameString") {
            let trimmed = name.trim().to_string();
            if !trimmed.is_empty() {
                probe.cpu_name = trimmed;
            }
        }
    }

    // Logical cores from GetSystemInfo
    unsafe {
        let mut info: SYSTEM_INFO = std::mem::zeroed();
        GetSystemInfo(&mut info);
        if info.dwNumberOfProcessors > 0 {
            probe.logical_cores = info.dwNumberOfProcessors as usize;
        }
    }

    // Total RAM from GlobalMemoryStatusEx
    unsafe {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            dwMemoryLoad: 0,
            ullTotalPhys: 0,
            ullAvailPhys: 0,
            ullTotalPageFile: 0,
            ullAvailPageFile: 0,
            ullTotalVirtual: 0,
            ullAvailVirtual: 0,
            ullAvailExtendedVirtual: 0,
        };
        if GlobalMemoryStatusEx(&mut status) != 0 {
            probe.total_ram_bytes = status.ullTotalPhys;
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn probe_linux_local_stt_hardware(probe: &mut LocalSttHardwareProbe) {
    if let Ok(cpuinfo) = fs::read_to_string("/proc/cpuinfo") {
        if let Some(line) = cpuinfo.lines().find(|line| line.starts_with("model name")) {
            if let Some((_, value)) = line.split_once(':') {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    probe.cpu_name = trimmed.to_string();
                }
            }
        }
    }

    if let Ok(meminfo) = fs::read_to_string("/proc/meminfo") {
        if let Some(line) = meminfo.lines().find(|line| line.starts_with("MemTotal:")) {
            let kib = line
                .split_whitespace()
                .nth(1)
                .and_then(|token| token.parse::<u64>().ok())
                .unwrap_or(0);
            if kib > 0 {
                probe.total_ram_bytes = kib.saturating_mul(1024);
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn probe_macos_local_stt_hardware(probe: &mut LocalSttHardwareProbe) {
    let capture = |command_name: &str, args: &[&str]| -> Option<String> {
        let mut command = Command::new(command_name);
        apply_no_window(&mut command);
        command
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            return None;
        }
        Some(text)
    };

    if let Some(cpu_name) = capture("sysctl", &["-n", "machdep.cpu.brand_string"]) {
        probe.cpu_name = cpu_name;
    }
    if let Some(memsize_raw) = capture("sysctl", &["-n", "hw.memsize"]) {
        if let Some(memsize) = parse_u64_token(&memsize_raw) {
            probe.total_ram_bytes = memsize;
        }
    }
}

pub(crate) fn probe_nvidia_gpu_for_local_stt(probe: &mut LocalSttHardwareProbe) {
    let mut command = Command::new("nvidia-smi");
    apply_no_window(&mut command);
    command
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    if let Ok(output) = command.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut best_name = String::new();
            let mut best_vram_mb = 0_u64;
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let mut segments = trimmed.splitn(2, ',').map(str::trim);
                let name = segments.next().unwrap_or_default();
                let memory_text = segments.next().unwrap_or_default();
                let vram_mb = parse_u64_token(memory_text).unwrap_or(0);
                if vram_mb >= best_vram_mb {
                    best_vram_mb = vram_mb;
                    best_name = name.to_string();
                }
            }

            if !best_name.is_empty() || best_vram_mb > 0 {
                probe.nvidia_gpu_detected = true;
                probe.gpu_name = best_name;
                probe.gpu_vram_mb = best_vram_mb;
                return;
            }
        }
    }

    if !crate::services::transcribe::detect_nvidia_gpu_available() {
        return;
    }

    probe.nvidia_gpu_detected = true;
    let mut list_command = Command::new("nvidia-smi");
    apply_no_window(&mut list_command);
    list_command
        .arg("-L")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Ok(output) = list_command.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = stdout.lines().find(|line| !line.trim().is_empty()) {
                if let Some((_, name_tail)) = first_line.split_once(':') {
                    let cleaned = name_tail.split('(').next().unwrap_or(name_tail).trim();
                    if !cleaned.is_empty() {
                        probe.gpu_name = cleaned.to_string();
                    }
                }
            }
        }
    }
}

pub(crate) fn local_stt_performance_tier(
    probe: &LocalSttHardwareProbe,
    ram_gb: f64,
    gpu_vram_gb: f64,
) -> &'static str {
    let strong_cpu = probe.logical_cores >= 8;
    let low_cpu = probe.logical_cores > 0 && probe.logical_cores <= 4;
    let ample_ram = ram_gb >= 16.0;
    let low_ram = ram_gb > 0.0 && ram_gb <= 8.0;
    let strong_gpu = probe.nvidia_gpu_detected && gpu_vram_gb >= 8.0;
    let mid_gpu = probe.nvidia_gpu_detected && gpu_vram_gb >= 4.0;

    if strong_gpu && ample_ram {
        return "performance";
    }
    if (mid_gpu && ram_gb >= 12.0) || (ample_ram && strong_cpu) {
        return "balanced";
    }
    if low_ram || low_cpu {
        return "basic";
    }
    if ram_gb >= 10.0 && probe.logical_cores >= 6 {
        return "balanced";
    }
    "basic"
}

pub(crate) fn local_stt_models_for_tier(
    tier: &str,
    _nvidia_gpu_detected: bool,
) -> (&'static str, Vec<&'static str>, Vec<&'static str>) {
    // Performance: strong CPU/GPU + ample RAM can handle the larger 0.6B model.
    // Balanced/Basic: recommend the lightweight 110m model; caution about the
    // heavier 0.6B model which may be slow on constrained hardware.
    // NOTE: Native Parakeet runs on CPU int8 regardless of GPU, so
    // _nvidia_gpu_detected is unused today but reserved for future GPU-accelerated
    // inference paths.
    match tier {
        "performance" => (
            "nvidia/parakeet-tdt-0.6b-v3",
            vec!["nvidia/parakeet-tdt-0.6b-v3", "nvidia/parakeet-tdt_ctc-110m"],
            vec![],
        ),
        "balanced" => (
            "nvidia/parakeet-tdt_ctc-110m",
            vec!["nvidia/parakeet-tdt_ctc-110m"],
            vec!["nvidia/parakeet-tdt-0.6b-v3"],
        ),
        _ => (
            "nvidia/parakeet-tdt_ctc-110m",
            vec!["nvidia/parakeet-tdt_ctc-110m"],
            vec!["nvidia/parakeet-tdt-0.6b-v3"],
        ),
    }
}

pub(crate) fn build_local_stt_hardware_advice(
    selected_model: Option<String>,
) -> crate::commands::local_stt::LocalSttHardwareAdviceResponse {
    let probe = probe_local_stt_hardware();
    let ram_gb_raw = if probe.total_ram_bytes > 0 {
        probe.total_ram_bytes as f64 / (1024.0 * 1024.0 * 1024.0)
    } else {
        0.0
    };
    let gpu_vram_gb_raw = if probe.gpu_vram_mb > 0 {
        probe.gpu_vram_mb as f64 / 1024.0
    } else {
        0.0
    };
    let ram_gb = round_to_single_decimal(ram_gb_raw);
    let gpu_vram_gb = round_to_single_decimal(gpu_vram_gb_raw);
    let tier = local_stt_performance_tier(&probe, ram_gb_raw, gpu_vram_gb_raw);
    let (suggested_model, suggested_candidates, caution_candidates) =
        local_stt_models_for_tier(tier, probe.nvidia_gpu_detected);
    let catalog = built_in_local_stt_model_catalog();

    let mut suggested_models = Vec::<String>::new();
    for candidate in suggested_candidates {
        if catalog.iter().any(|item| item == candidate)
            && !suggested_models.iter().any(|item| item == candidate)
        {
            suggested_models.push(candidate.to_string());
        }
    }
    if suggested_models.is_empty() {
        suggested_models.push(suggested_model.to_string());
    }

    let mut caution_models = Vec::<String>::new();
    for candidate in caution_candidates {
        if catalog.iter().any(|item| item == candidate)
            && !caution_models.iter().any(|item| item == candidate)
        {
            caution_models.push(candidate.to_string());
        }
    }

    let selected_model = selected_model
        .as_deref()
        .map(|value| canonical_local_stt_model_id(&normalize_model_name(Some(value))))
        .unwrap_or_default();

    let selected_model_warning = if !selected_model.is_empty()
        && caution_models.iter().any(|item| item == &selected_model)
    {
        let selected_label = local_stt_model_display_label(&selected_model);
        let size_gb = local_stt_model_size_gb(&selected_model);
        if size_gb > 0.0 {
            format!(
                "Warning: {selected_label} (~{size_gb:.1} GB) is hardware-hungry on this device and can be very slow."
            )
        } else {
            format!(
                "Warning: {selected_label} is hardware-hungry on this device and can be very slow."
            )
        }
    } else {
        String::new()
    };

    let cpu_name = if probe.cpu_name.trim().is_empty() {
        "Unknown CPU".to_string()
    } else {
        probe.cpu_name.trim().to_string()
    };
    let gpu_name = if probe.nvidia_gpu_detected {
        if probe.gpu_name.trim().is_empty() {
            "NVIDIA GPU".to_string()
        } else {
            probe.gpu_name.trim().to_string()
        }
    } else {
        String::new()
    };

    let caution_labels = caution_models
        .iter()
        .map(|model| local_stt_model_display_label(model))
        .collect::<Vec<String>>();
    let caution_suffix = if caution_labels.is_empty() {
        String::new()
    } else {
        format!(
            " Heavy models on this hardware: {}.",
            caution_labels.join(", ")
        )
    };
    let gpu_summary = if probe.nvidia_gpu_detected {
        if gpu_vram_gb > 0.0 {
            format!("{gpu_name} ({gpu_vram_gb:.1} GB VRAM)")
        } else {
            gpu_name.clone()
        }
    } else {
        "No NVIDIA GPU detected".to_string()
    };
    let details = format!(
        "Hardware profile detected: {} logical cores, {:.1} GB RAM, {}. Higher models use much more RAM/VRAM and can be slower. Start with {}.{}",
        probe.logical_cores,
        ram_gb,
        gpu_summary,
        local_stt_model_display_label(suggested_model),
        caution_suffix
    );

    crate::commands::local_stt::LocalSttHardwareAdviceResponse {
        cpu_name,
        logical_cores: probe.logical_cores,
        total_ram_gb: ram_gb,
        nvidia_gpu_detected: probe.nvidia_gpu_detected,
        gpu_name,
        gpu_vram_gb,
        performance_tier: tier.to_string(),
        slasshy_suggestion_model: suggested_model.to_string(),
        suggested_models,
        caution_models,
        selected_model_warning,
        details,
    }
}

#[cfg(test)]
mod tests {
    // ===== HARDWARE TIER RECOMMENDATION POLICY =====

    #[test]
    fn performance_tier_suggests_heavier_model() {
        let (suggested, suggested_candidates, caution) =
            super::local_stt_models_for_tier("performance", false);
        assert_eq!(suggested, "nvidia/parakeet-tdt-0.6b-v3");
        assert!(suggested_candidates.contains(&"nvidia/parakeet-tdt-0.6b-v3"));
        assert!(suggested_candidates.contains(&"nvidia/parakeet-tdt_ctc-110m"));
        assert!(caution.is_empty());
    }

    #[test]
    fn balanced_tier_suggests_lightweight_model() {
        let (suggested, suggested_candidates, caution) =
            super::local_stt_models_for_tier("balanced", false);
        assert_eq!(suggested, "nvidia/parakeet-tdt_ctc-110m");
        assert_eq!(suggested_candidates, vec!["nvidia/parakeet-tdt_ctc-110m"]);
        assert!(caution.contains(&"nvidia/parakeet-tdt-0.6b-v3"));
    }

    #[test]
    fn basic_tier_suggests_lightweight_model() {
        let (suggested, suggested_candidates, caution) =
            super::local_stt_models_for_tier("basic", false);
        assert_eq!(suggested, "nvidia/parakeet-tdt_ctc-110m");
        assert_eq!(suggested_candidates, vec!["nvidia/parakeet-tdt_ctc-110m"]);
        assert!(caution.contains(&"nvidia/parakeet-tdt-0.6b-v3"));
    }

    #[test]
    fn unknown_tier_defaults_to_lightweight() {
        let (suggested, _, _) = super::local_stt_models_for_tier("unknown", false);
        assert_eq!(suggested, "nvidia/parakeet-tdt_ctc-110m");
    }

    // ===== HARDWARE TIER CLASSIFICATION =====

    fn make_probe(logical_cores: usize, ram_bytes: u64, nvidia: bool, vram_mb: u64) -> super::LocalSttHardwareProbe {
        super::LocalSttHardwareProbe {
            cpu_name: "Test CPU".to_string(),
            logical_cores,
            total_ram_bytes: ram_bytes,
            nvidia_gpu_detected: nvidia,
            gpu_name: if nvidia { "NVIDIA GPU".to_string() } else { String::new() },
            gpu_vram_mb: vram_mb,
        }
    }

    #[test]
    fn tier_performance_with_strong_gpu_and_ram() {
        // 8+ cores, 16+ GB RAM, 8+ GB VRAM → performance
        let probe = make_probe(12, 32 * 1024 * 1024 * 1024, true, 12 * 1024);
        assert_eq!(super::local_stt_performance_tier(&probe, 32.0, 12.0), "performance");
    }

    #[test]
    fn tier_basic_with_low_ram() {
        let probe = make_probe(4, 4 * 1024 * 1024 * 1024, false, 0);
        assert_eq!(super::local_stt_performance_tier(&probe, 4.0, 0.0), "basic");
    }

    #[test]
    fn tier_balanced_with_mid_gpu() {
        // 4+ GB VRAM + 12+ GB RAM → balanced
        let probe = make_probe(6, 16 * 1024 * 1024 * 1024, true, 6 * 1024);
        assert_eq!(super::local_stt_performance_tier(&probe, 16.0, 6.0), "balanced");
    }

    #[test]
    fn tier_balanced_with_ample_ram_and_strong_cpu() {
        // 16+ GB RAM + 8+ cores → balanced (no GPU)
        let probe = make_probe(8, 16 * 1024 * 1024 * 1024, false, 0);
        assert_eq!(super::local_stt_performance_tier(&probe, 16.0, 0.0), "balanced");
    }

}
