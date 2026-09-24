fn main() {
    // transcribe-cpp links whisper.cpp's Vulkan backend as `vulkan-1` but emits no search
    // path for it, and the LunarG installer sets only VULKAN_SDK — never LIB — so the
    // import library is unresolvable by default. whisper.cpp's own cmake already requires
    // VULKAN_SDK, so pointing the linker at the same install costs nothing and keeps the
    // version out of the tree.
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        println!("cargo:rerun-if-env-changed=VULKAN_SDK");
        if let Ok(sdk) = std::env::var("VULKAN_SDK") {
            let lib = std::path::Path::new(&sdk).join("Lib");
            if lib.join("vulkan-1.lib").exists() {
                println!("cargo:rustc-link-search=native={}", lib.display());
            }
        }
    }

    tauri_build::build()
}
