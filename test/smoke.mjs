import path from "path";
import { fileURLToPath } from "url";

import httpServer from "http-server";
import { chromium } from "playwright";

// Smoke test: the data/loader.js flow must boot end to end in both
// the minified and the debug build — window.EJS_emulator is set, the ready
// event fires, and no uncaught page errors occur.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.resolve(__dirname, "../");

let failures = 0;
function check(name, condition) {
    if (condition) {
        console.log("PASS:", name);
    } else {
        failures++;
        console.error("FAIL:", name);
    }
}

async function checkLoaderBoot(browser, baseUrl, suffix, label) {
    const page = await browser.newPage();
    const pageErrors = [];
    const requests = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("request", (r) => requests.push(r.url()));

    await page.goto(baseUrl + "/test/loader.html" + suffix);
    await page.waitForFunction(() => window.EJS_emulator && window.__ejsReadyFired, null, { timeout: 30000 });

    const state = await page.evaluate(() => ({
        emulatorSet: !!window.EJS_emulator,
        readyFired: !!window.__ejsReadyFired,
        adBlockedType: typeof window.EJS_adBlocked,
        system: window.EJS_emulator && window.EJS_emulator.config.system,
        dataPath: window.EJS_emulator && window.EJS_emulator.config.dataPath,
        startButton: !!document.querySelector("#game .ejs_start_button"),
        cssLink: !!document.querySelector('head link[href*="emulator.min.css"], head link[href*="emulator.css"]')
    }));

    check(label + ": window.EJS_emulator is set", state.emulatorSet);
    check(label + ": ready event fired", state.readyFired);
    check(label + ": window.EJS_adBlocked is set", state.adBlockedType === "function");
    check(label + ": config.system mapped from EJS_core", state.system === "nes");
    check(label + ": data path derived from loader.js URL", typeof state.dataPath === "string" && state.dataPath.endsWith("/data/"));
    check(label + ": start button rendered in #game", state.startButton);
    check(label + ": emulator css <link> injected into head", state.cssLink);
    check(label + ": no uncaught page errors", pageErrors.length === 0);
    if (pageErrors.length) console.error("page errors:", pageErrors);

    await page.close();
    return requests;
}

async function main() {
    const server = httpServer.createServer({ root: rootPath, cache: -1 });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;
    console.log("Serving", rootPath, "at", baseUrl);

    const browser = await chromium.launch();
    try {
        const minRequests = await checkLoaderBoot(browser, baseUrl, "", "loader (minified)");
        check("loader (minified): emulator bundle requested", minRequests.some((u) => u.includes("/data/emulator.min.js")));

        const debugRequests = await checkLoaderBoot(browser, baseUrl, "?debug", "loader (debug)");
        check("loader (debug): unbundled src/emulator.js requested", debugRequests.some((u) => u.includes("/data/src/emulator.js")));
    } finally {
        await browser.close();
        server.close();
    }

    if (failures) {
        console.error(failures + " check(s) failed");
        process.exit(1);
    }
    console.log("All checks passed");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
