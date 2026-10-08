/** Synthetic preview only: no production accounts or remote database writes. */
const http = require("http"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict");
const { chromium } = require("playwright");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const artifacts = path.join(root, ".ui-artifacts");
fs.mkdirSync(artifacts, { recursive: true });
let role = "admin",
  origin;
const userId = "22222222-2222-4222-8222-222222222222",
  repId = "11111111-1111-4111-8111-111111111111";
const now = new Date();
const isoHours = (n) => new Date(now.getTime() + n * 3600000).toISOString();
const reps = [
  {
    id: repId,
    user_id: userId,
    name: "Preview Admin",
    email: "preview-admin@example.test",
    role: "admin",
    active: true,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: "44444444-4444-4444-8444-444444444444",
    name: "Alex Setter",
    email: "setter@example.test",
    role: "appointment_setter",
    active: true,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Jordan Sales",
    email: "sales@example.test",
    role: "salesperson",
    active: true,
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    name: "Taylor Manager",
    email: "manager@example.test",
    role: "manager",
    active: true,
  },
];
const leads = Array.from({ length: 240 }, (_, i) => ({
  id: "TEST-" + i,
  name: "Preview Homeowner " + i,
  address: 100 + i + " Sample Street",
  city: "Mount Vernon",
  state: "OH",
  zip: "43050",
  lat: 40.39 + i * 0.0001,
  lng: -82.48,
  status: "New",
}));
const appointments = Array.from({ length: 125 }, (_, i) => ({
  id: "APPT-" + i,
  lead_id: leads[i].id,
  canvasser_id: reps[1].id,
  salesperson_id: i % 3 ? reps[2].id : null,
  scheduled_at: isoHours(i - 5),
  stage: i === 3 ? "No-show" : "Scheduled",
  canvasser: { name: "Alex Setter", role: "appointment_setter" },
  salesperson: i % 3 ? { name: "Jordan Sales", role: "salesperson" } : null,
  notes: "Preview handoff notes",
}));
const homes = [
  {
    id: "HOME-1",
    lead_id: "TEST-2",
    first_name: "Preview",
    last_name: "Homeowner",
    address: "102 Sample Street",
    city: "Mount Vernon",
    phone: "555-0100",
    source: "public_homeowner_form",
    status: "New",
    created_at: isoHours(-2),
  },
];
const activities = Array.from({ length: 140 }, (_, i) => ({
  id: "ACT-" + i,
  lead_id: leads[i].id,
  actor_id: reps[1].id,
  actor: { name: "Alex Setter", role: "appointment_setter" },
  created_at: isoHours(-i * 0.01),
  action: i % 4 ? "status_changed" : "setter_appointment_booked",
  metadata: { to_status: i % 4 ? "Knocked" : "Appointment" },
}));
const db = {
  reps,
  leads,
  appointments,
  homeowner_intakes: homes,
  lead_activity: activities,
  training_items: [
    {
      id: "TRAIN-1",
      title: "Preview field lesson",
      kind: "image",
      audience: "both",
      active: true,
      storage_path: "preview.png",
      required: true,
    },
  ],
  form_submissions: [
    {
      id: "FORM-1",
      template_name: "Preview inspection",
      lead_id: "TEST-2",
      homeowner_name: "Preview Homeowner",
      address_snapshot: "102 Sample Street",
      created_at: isoHours(-1),
      fields: [{ id: "note", label: "Inspection notes", type: "text" }],
      answers: { note: "Preview record" },
      submitter: { name: "Preview Admin" },
    },
  ],
  territories: [
    {
      id: "T-1",
      name: "Mount Vernon",
      city: "Mount Vernon",
      owner: { name: "Alex Setter", role: "appointment_setter" },
    },
  ],
};
let writes = [];
function currentRep() {
  return {
    ...reps[0],
    role,
    name:
      role === "admin"
        ? "Preview Admin"
        : role === "salesperson"
          ? "Preview Sales Rep"
          : role === "manager"
            ? "Preview Manager"
            : "Preview Setter",
  };
}
function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: userId,
    email: "preview-admin@example.test",
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { name: currentRep().name },
  };
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return {
    access_token:
      encode({ alg: "HS256", typ: "JWT" }) +
      "." +
      encode({ ...user, sub: userId, exp }) +
      ".preview",
    refresh_token: "preview-refresh-token",
    token_type: "bearer",
    expires_at: exp,
    expires_in: 3600,
    user,
  };
}
const send = (res, data, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin || "http://localhost");
  if (url.pathname === "/api/config")
    return send(res, {
      configured: true,
      url: origin,
      publishableKey: "preview-only",
      adminEmails: ["preview-admin@example.test"],
      homeownerFormUrl: origin + "/homeowner.html",
    });
  if (url.pathname.startsWith("/storage/v1/object/sign/"))
    return send(res, { signedURL: "/object/public/training/preview.png" });
  if (url.pathname === "/storage/v1/object/public/training/preview.png") {
    res.setHeader("content-type", "image/png");
    return res.end(fs.readFileSync(path.join(root, "brand/favicon.png")));
  }
  if (url.pathname.startsWith("/auth/v1/"))
    return send(
      res,
      url.pathname.endsWith("/user") ? session().user : session(),
    );
  if (url.pathname === "/api/field")
    return send(res, {
      rep: currentRep(),
      isField: ["appointment_setter", "salesperson"].includes(role),
      isAdmin: ["admin", "manager"].includes(role),
      openShift: null,
      consent: { consented_at: isoHours(-24) },
      unread: 0,
      threads: [],
      messages: [],
    });
  if (url.pathname === "/api/inspection") {
    let body = "";
    for await (const c of req) body += c;
    const data = JSON.parse(body);
    writes.push({ table: "inspection", data });
    return send(res, {
      ok: true,
      lead_id: "TEST-SAVED",
      intake_id: "HOME-SAVED",
      appointment_id: "APPT-SAVED",
      updated: false,
    });
  }
  if (url.pathname === "/api/weather")
    return send(res, { forecast: null, alerts: [] });
  if (url.pathname === "/api/storm-maps")
    return send(res, { radar: [], warnings: [], reports: [] });
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const name = url.pathname.split("/").pop();
    return send(
      res,
      name === "password_gate_status"
        ? { must_change: false, impersonating: false }
        : name === "account_directory"
          ? reps
          : [],
    );
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const name = url.pathname.split("/")[3];
    let rows = (db[name] || []).map((row) =>
      name === "reps" && row.id === repId ? currentRep() : row,
    );
    if (req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const data = {
        id: "NEW-" + Date.now(),
        created_at: new Date().toISOString(),
        ...JSON.parse(body),
      };
      writes.push({ table: name, data });
      db[name] ||= [];
      db[name].push(data);
      return send(
        res,
        (req.headers.accept || "").includes("vnd.pgrst.object") ? data : [data],
        201,
      );
    }
    for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq."))
        rows = rows.filter((row) => String(row[key]) === value.slice(3));
      if (value.startsWith("gte."))
        rows = rows.filter((row) => String(row[key]) >= value.slice(4));
      if (value.startsWith("lt."))
        rows = rows.filter((row) => String(row[key]) < value.slice(3));
    }
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 1000);
    rows = rows.slice(offset, offset + limit);
    const single = (req.headers.accept || "").includes("vnd.pgrst.object");
    return send(res, single ? rows[0] || null : rows);
  }
  let pathname = url.pathname;
  if (!path.extname(pathname) && pathname !== "/") pathname += ".html";
  const file = path.join(root, pathname === "/" ? "index.html" : pathname);
  if (
    !file.startsWith(root) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    res.writeHead(404);
    res.end("Missing");
    return;
  }
  res.setHeader(
    "content-type",
    {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".json": "application/json",
      ".webp": "image/webp",
      ".png": "image/png",
    }[path.extname(file)] || "application/octet-stream",
  );
  res.end(fs.readFileSync(file));
});
(async () => {
  await esbuild.build({
    entryPoints: [
      path.join(root, "node_modules/@supabase/supabase-js/dist/index.mjs"),
    ],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile: path.join(artifacts, "supabase-bundle.js"),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
    args: process.env.PLAYWRIGHT_CHROMIUM_ARGS
      ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS)
      : [],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
  });
  await context.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: fs.readFileSync(path.join(artifacts, "supabase-bundle.js")),
      }),
  );
  await context.route("**/realtime/**", (route) => route.abort());
  const page = await context.newPage();
  async function openManagement() {
    await page.waitForTimeout(120); // Let the responsive collapse preference settle.
    const head = page.locator(".rail > .tnFoldBar .tnFoldHead");
    if (
      (await head.count()) &&
      (await head.getAttribute("aria-expanded")) === "false"
    )
      await head.click();
    await page.waitForFunction(
      () => !document.querySelector(".rail")?.classList.contains("isCollapsed"),
    );
  }
  async function checkTutorial(label, screenshot) {
    await page.locator("#tnPageHelp").click();
    await page.locator(".pageTourCard").waitFor();
    assert.ok(
      (await page.locator("#pageTourText").innerText()).length > 40,
      label + " has clear instructions",
    );
    const count = Number(
      (await page.locator(".pageTourProgress").innerText()).match(
        /of (\d+)/,
      )[1],
    );
    assert.ok(count > 0 && count < 15, label + " bounded tutorial");
    for (let i = 0; i < count; i++) {
      const bounds = await page.locator(".pageTourCard").boundingBox();
      const viewport = page.viewportSize();
      assert.ok(
        bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= viewport.width + 1 &&
          bounds.y + bounds.height <= viewport.height + 1,
        label + " tooltip fits viewport",
      );
      if (i === 0 && screenshot)
        await page.screenshot({ path: path.join(artifacts, screenshot) });
      try {
        await page.locator(".pageTourNext").click({ timeout: 5000 });
      } catch (error) {
        await page.screenshot({
          path: path.join(artifacts, "tutorial-failure.png"),
        });
        console.log(
          "Tutorial failure",
          label,
          i,
          await page.evaluate(() => ({
            card: document
              .querySelector(".pageTourCard")
              ?.getBoundingClientRect()
              .toJSON(),
            next: document
              .querySelector(".pageTourNext")
              ?.getBoundingClientRect()
              .toJSON(),
            top: document.querySelector("#pageTourTitle")?.textContent,
            scrollY,
          })),
        );
        throw error;
      }
    }
    assert.equal(
      await page.locator(".pageTour").count(),
      0,
      label + " completes",
    );
    assert.equal(
      await page.locator("#tnPageHelp").getAttribute("aria-expanded"),
      "false",
    );
    await page.locator("#tnPageHelp").click();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".pageTour").count(),
      0,
      label + " Escape closes",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "tnPageHelp",
      label + " focus returns",
    );
    console.log(label + " tutorial passed");
  }
  const errors = [];
  const navigationWarnings = [];
  page.on("pageerror", (e) => {
    if (
      e.message ===
      "Transition was aborted because of invalid state. ViewTransition opt-in disabled"
    ) {
      navigationWarnings.push(e.message);
      return;
    }
    errors.push(e.message);
    console.log("PAGE ERROR", e.message);
  });
  await page.addInitScript((s) => {
    if (sessionStorage.getItem("preview-signed-out") === "1") return;
    localStorage.setItem("sb-127-auth-token", JSON.stringify(s));
    localStorage.setItem("tn-role:" + s.user.id, "admin");
  }, session());
  await page.goto(origin + "/admin.html");
  await page.locator("#metrics .metric").first().waitFor();
  console.log("admin loaded", await page.locator("#metrics").innerText());
  await page.screenshot({ path: path.join(artifacts, "admin.png") });
  await page.locator(".rail [data-tab=appointments]").click();
  assert.equal(await page.locator("#apptTable tr").count(), 100);
  await page.getByRole("button", { name: "Show 100 more" }).click();
  assert.equal(await page.locator("#apptTable tr").count(), 125);
  console.log("pagination ok");
  await checkTutorial("admin appointments");
  await page.locator(".rail [data-tab=accounts]").click();
  await page.locator("#accountQuery").waitFor();
  await page.locator("#accountRoleFilter").selectOption("salesperson");
  assert.equal(await page.locator("#tnPeopleList .tnAccountCard").count(), 1);
  await page.locator("#accountRoleFilter").selectOption("");
  await page.screenshot({ path: path.join(artifacts, "accounts.png") });
  console.log("profile filters ok");
  await checkTutorial("admin accounts", "tutorial-accounts.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await openManagement();
  await page.locator(".rail [data-tab=overview]").click();
  await checkTutorial("mobile admin overview", "tutorial-mobile-admin.png");
  await page.screenshot({
    path: path.join(artifacts, "mobile-admin.png"),
    fullPage: true,
  });
  console.log(
    "admin width",
    await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    })),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const nextRole of [
    "appointment_setter",
    "salesperson",
    "manager",
    "admin",
  ]) {
    role = nextRole;
    await page.goto(origin + "/account.html");
    await page.locator(".profileHero").waitFor();
    await page.screenshot({
      path: path.join(artifacts, "account-" + role + ".png"),
      fullPage: true,
    });
    console.log(role, "tools", await page.locator(".profileAction").count());
  }
  role = "appointment_setter";
  await page.goto(origin + "/setter.html");
  await page.locator("#setterApp").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(artifacts, "setter-signed.png"),
    fullPage: true,
  });
  console.log("setter loaded");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(artifacts, "mobile-setter.png"),
    fullPage: true,
  });
  console.log(
    "setter width",
    await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    })),
  );
  role = "salesperson";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/rep.html");
  await page.locator("#q").waitFor();
  await page.locator("#q").fill("Sample");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(artifacts, "sales-signed.png") });
  console.log("sales loaded");

  role = "appointment_setter";
  await page.goto(origin + "/setter.html");
  await page.locator("#setterApp").waitFor({ state: "visible" });
  await page.locator("#s_first_name").fill("Test");
  await page.locator("#s_last_name").fill("Homeowner");
  await page.locator("#s_phone").fill("555-0100");
  await page.locator("#address").fill("123 Preview Street");
  await page.locator("#zip").fill("43050");
  await page.locator("#consent_contact").check();
  await page.locator("#s_date").fill("2026-11-15");
  await page.locator("#s_time").fill("10:30");
  await page.locator("#salesperson").selectOption(reps[2].id);
  await page.locator("#setterForm button[type=submit]").click();
  await page
    .locator("#saveStatus")
    .filter({ hasText: "Inspection saved" })
    .waitFor();
  assert.deepEqual(
    writes.map((w) => w.table),
    ["inspection"],
  );
  assert.equal(writes[0].data.consent_contact, true);
  assert.equal(writes[0].data.salesperson_id, reps[2].id);
  assert.equal(
    await page.locator("#setterForm button[type=submit]").isDisabled(),
    true,
  );
  await page.evaluate(() =>
    document.getElementById("setterForm").requestSubmit(),
  );
  await page.waitForTimeout(100);
  assert.equal(writes.length, 1);
  await page.locator("#clearForm").click();
  assert.equal(await page.locator("#s_first_name").inputValue(), "");
  assert.equal(
    await page.locator("#setterForm button[type=submit]").isDisabled(),
    false,
  );
  console.log("handoff save, duplicate guard, and reset passed");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workspaceMenuBtn").click();
  assert.equal(
    await page.locator(".workspaceMenuBtn").getAttribute("aria-expanded"),
    "true",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator(".workspaceMenuBtn").getAttribute("aria-expanded"),
    "false",
  );
  console.log("mobile menu keyboard passed");
  role = "admin";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/admin.html");
  await page.locator("#metrics .metric").first().waitFor();
  await page
    .locator("#dashboardAttention button[data-focus=unassigned]")
    .click();
  assert.equal(await page.locator("#apptTable tr").count(), 41);
  await page.locator("#clearAppointmentFocus").click();
  assert.equal(await page.locator("#apptTable tr").count(), 100);
  await page.locator(".rail [data-tab=accounts]").click();
  await page.locator(".accountCreate summary").click();
  await page.locator("#acctName").fill("Draft teammate");
  await page.locator("#accountQuery").fill("Jordan");
  assert.equal(await page.locator("#acctName").inputValue(), "Draft teammate");
  assert.equal(await page.locator("#tnPeopleList .tnAccountCard").count(), 1);
  console.log("attention queues and account draft preservation passed");
  for (const route of [
    "account",
    "setter",
    "rep",
    "forms",
    "files",
    "training",
    "photo",
    "shifts",
    "reset-password",
    "form-print",
  ]) {
    role = route === "training" ? "appointment_setter" : "admin";
    const query =
      route === "photo"
        ? "?lead=TEST-2"
        : route === "form-print"
          ? "?id=FORM-1"
          : "";
    await page.goto(origin + "/" + route + ".html" + query);
    await page.waitForTimeout(450);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        route + " overflow at " + width,
      );
    }
    await checkTutorial(route);
    await page.setViewportSize({ width: 390, height: 844 });
    await checkTutorial("mobile " + route);
    if (route === "photo") {
      assert.equal(
        await page.locator("#take").count(),
        1,
        "selected property capture loaded",
      );
      await page
        .locator("#take")
        .setInputFiles(path.join(root, "brand/favicon.png"));
      await page.locator("#savePhoto").waitFor();
      await checkTutorial("photo preview");
    }
    if (route === "training") {
      await page.locator('[data-item="TRAIN-1"]').click();
      await page.locator("#tnTrainControls button").waitFor();
      await checkTutorial("training lesson");
    }
    console.log(route + " responsive widths passed");
  }

  await page.goto(origin + "/homeowner.html");
  await page.waitForURL("**/setter.html");
  console.log("legacy homeowner link reaches unified inspection form");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/");
  await page.locator("#workList .leadRow").first().waitFor();
  if (await page.locator("#postSignInContinue").isVisible())
    await page.locator("#postSignInContinue").click();
  await page.locator("#routeBtn").click();
  await page.locator("#routePanel").waitFor({ state: "visible" });
  await page.waitForTimeout(100);
  await page.locator("#openGoogleRouteBtn").focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() =>
      document.getElementById("routePanel").contains(document.activeElement),
    ),
    true,
  );
  await page.keyboard.press("Escape");
  await page.locator("#routePanel").waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "routeBtn",
  );
  console.log("route dialog focus containment, Escape, and return passed");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "map overflow at " + width,
    );
  }
  await page.screenshot({ path: path.join(artifacts, "map.png") });
  await checkTutorial("map", "tutorial-map.png");
  await page.evaluate(() => {
    document.documentElement.classList.add("isNavigating");
    document.getElementById("navBar").classList.remove("hidden");
  });
  assert.equal(
    await page.locator(".workspaceNav").isVisible(),
    false,
    "fullscreen hides workspace rail",
  );
  const navBounds = await page.locator("#navBar").boundingBox();
  assert.ok(
    navBounds.x <= 16 && navBounds.width > page.viewportSize().width - 32,
    "fullscreen stop bar uses full width",
  );
  await checkTutorial("fullscreen navigation");
  await page.evaluate(() => {
    document.documentElement.classList.remove("isNavigating");
    document.getElementById("navBar").classList.add("hidden");
  });
  role = "appointment_setter";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/setter.html");
  await page.locator("#setterApp").waitFor({ state: "visible" });
  await page.locator("#s_first_name").fill("Keep my draft");
  const foldedBefore = await page
    .locator("#setterForm .tnFold.isCollapsed")
    .count();
  await checkTutorial("mobile inspection", "tutorial-mobile-setter.png");
  assert.equal(
    await page.locator("#s_first_name").inputValue(),
    "Keep my draft",
    "guide keeps draft",
  );
  assert.equal(
    await page.locator("#setterForm .tnFold.isCollapsed").count(),
    foldedBefore,
    "guide restores collapsed sections",
  );
  const property = page.locator("[data-tn-panel=setter-property]");
  await page.locator(".formSectionNav a").nth(1).click();
  assert.equal(
    await property.evaluate((el) => el.classList.contains("isCollapsed")),
    false,
    "section shortcut expands fields",
  );
  console.log("fullscreen layout and draft/collapse preservation passed");
  await page.goto(origin + "/account.html");
  await page.locator("#accountSignOut").waitFor();
  await page.evaluate(() => sessionStorage.setItem("preview-signed-out", "1"));
  await page.locator("#accountSignOut").click();
  await page.waitForURL(origin + "/");
  await page.locator("#loginForm").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#map").isVisible(),
    false,
    "opaque sign-in after logout",
  );
  await checkTutorial("signed-out map", "tutorial-sign-in.png");
  await page.goto(origin + "/account.html");
  await page.locator("#tnLogin").waitFor({ state: "visible" });
  await checkTutorial("signed-out account");
  console.log("logout cover and sign-in tutorials passed");
  assert.deepEqual(errors, [], "No unhandled browser errors");
  console.log("UI smoke passed. Screenshots: " + artifacts);
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
