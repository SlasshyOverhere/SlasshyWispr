from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("http://localhost:5173")
    page.wait_for_timeout(500)

    # Dictionary page
    page.get_by_role("button", name="Dictionary").click()
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/screenshots/dictionary.png")

    # Snippets page
    page.get_by_role("button", name="Snippets").click()
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/screenshots/snippets.png")

    # Notes page
    page.get_by_role("button", name="Notes").click()
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/screenshots/notes.png")

    page.wait_for_timeout(1000)

if __name__ == "__main__":
    import os
    import shutil
    import subprocess
    import time

    # Start the server in the background
    print("Starting server...")
    server = subprocess.Popen(["bun", "run", "dev"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(2) # Give it a moment to start

    try:
        os.makedirs("/home/jules/verification/videos", exist_ok=True)
        os.makedirs("/home/jules/verification/screenshots", exist_ok=True)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                record_video_dir="/home/jules/verification/videos"
            )
            page = context.new_page()
            try:
                run_cuj(page)
            finally:
                context.close()
                browser.close()

        # Rename video
        videos = os.listdir("/home/jules/verification/videos")
        for v in videos:
            if v.endswith(".webm"):
                shutil.move(f"/home/jules/verification/videos/{v}", "/home/jules/verification/videos/verification.webm")
                break
    finally:
        server.terminate()
        server.wait()
