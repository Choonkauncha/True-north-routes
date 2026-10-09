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
// Coach fixtures deliberately mix own and other-user records. No live services are used.
db.leads[0].assigned_rep_id = repId;
db.leads[0].status = 'Interested';
Object.assign(db.appointments[0], { canvasser_id: repId, salesperson_id: null, stage: 'Confirmed', scheduled_at: isoHours(24) });
db.lead_activity.push(...Array.from({length: 6}, (_, i) => ({ id: 'COACH-ACT-'+i, actor_id: repId, metadata: {to_status: 'Knocked'}, created_at: isoHours(-i) })));
db.lead_photos = [{id:'OWN-PHOTO',lead_id:'TEST-2',uploaded_by:repId,created_at:isoHours(-1),storage_path:'preview.png'}, {id:'OTHER-PHOTO',uploaded_by:reps[1].id,created_at:isoHours(-1)}];
db.form_submissions[0].submitted_by = repId;
db.shifts = [{rep_id:repId, clock_in_at:isoHours(-4), clock_out_at:isoHours(-2)}];
db.messages = [{sender_rep_id:repId,created_at:isoHours(-1)}, {sender_rep_id:reps[1].id,created_at:isoHours(-1)}];
db.training_progress = [];
db.training_assignments = [];
db.training_reminders = [];
let coachApi, coachLimiterFixture, coachCalls = [], liveTokenCalls = 0, coachGenerations=0, coachPostGate=null, coachGetGate=null, failNextCoachPost=false, failTrainingCompletion = false, injectCoachReply = true;
let writes = [];
let switchedAccount = false, warmLeadBoot = false, gateStatusFailure = false;
function currentRep() {
  return {
    ...reps[switchedAccount ? 1 : 0],
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
    id: currentRep().user_id,
    email: currentRep().email,
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { name: currentRep().name },
  };
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return {
    access_token:
      encode({ alg: "HS256", typ: "JWT" }) +
      "." +
      encode({ ...user, sub: user.id, exp }) +
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
  if (url.pathname === '/api/coach') {
    coachApi ||= await import(path.join(root, 'api/coach.js'));
    coachLimiterFixture ||= coachApi.createCoachLimiter({maxRequests:1000});
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = new Request(origin + req.url, {method:req.method, headers:req.headers, ...(body ? {body} : {})});
    coachCalls.push({method:req.method, body:body ? JSON.parse(body) : null});
    if(req.method==='POST'&&coachPostGate)await coachPostGate;
    if(req.method==='GET'&&coachGetGate)await coachGetGate;
    if(req.method==='POST'&&failNextCoachPost){failNextCoachPost=false;return send(res,{error:'Synthetic Coach reply failed. Your draft is retained.'},503);}
    const reply = await coachApi.handleCoach(request, {
      env:{SUPABASE_URL:origin,SUPABASE_PUBLISHABLE_KEY:'preview-only',AI_GATEWAY_MODEL:'test/fixture-only',AI_GATEWAY_API_KEY:'test-not-a-key'},
      now, limiter:coachLimiterFixture,
      generateImpl:async options => {
        coachGenerations+=1;
        const prefix=injectCoachReply ? '<img src=x onerror="window.coachInjected=true"> ' : '';
        injectCoachReply=false;
        return {text:prefix+'Practice reply: Preview, take one calm breath. Focus on listening, ask one useful question, and choose a clear next step. Your consistency gives you something real to build on.'};
      }
    });
    res.writeHead(reply.status,Object.fromEntries(reply.headers));
    return res.end(await reply.text());
  }
  if (url.pathname === '/api/live-token') {
    liveTokenCalls += 1;
    return send(res, { token: 'synthetic-live-token', model: 'gemini-3.8-live', voice: 'Kore', expiresAt: new Date(Date.now() + 1800000).toISOString(), systemInstruction: 'You are the positive True North Live Coach.' });
  }
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
  if (url.pathname === "/api/field" && url.searchParams.get('view') === 'shifts') {
    const date = url.searchParams.get('date') || '2026-10-09';
    return send(res, { date, people: [{
      rep: currentRep(),
      shifts: [{ id: 'SHIFT-1', clock_in_at: `${date}T13:00:00Z`, clock_out_at: `${date}T17:00:00Z`, open: false }],
      points: [{ latitude: 40.393, longitude: -82.486, captured_at: `${date}T14:00:00Z` }],
      miles: 1.25, totalHours: 4, longGap: false,
      consent: { consented_at: isoHours(-24) }
    }] });
  }
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
  if (url.pathname === "/api/route") {
    let body=""; for await(const c of req) body+=c;
    const data=JSON.parse(body);
    await new Promise(resolve=>setTimeout(resolve,500));
    return send(res,{geometry:{type:"LineString",coordinates:data.coordinates.map(p=>[p.lng,p.lat])},distance:2400,duration:360,order:data.coordinates.slice(1).map((_,i)=>i+1),steps:[]});
  }
  if (url.pathname === "/api/weather")
    return send(res, { forecast: {temperature:63,conditions:'Synthetic test forecast',high:68,low:48,windMph:5,rainChance:0,hours:[]}, alerts: [] });
  if (url.pathname === "/api/storm-maps")
    return send(res, { radar: [], warnings: [], reports: [] });
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const name = url.pathname.split("/").pop();
    if (name === 'password_gate_status' && gateStatusFailure) return send(res, {message:'Synthetic account check failed'}, 503);
    if (name === 'lead_map_boot' && warmLeadBoot) return send(res, {count: db.leads.length, newest:'2026-10-09T12:00:00.000Z', overlay:[], added:[]});
    return send(
      res,
      name === "feature_enabled" ? true : name === "password_gate_status"
        ? { must_change: false, impersonating: false }
        : name === "account_directory"
          ? reps
          : [],
    );
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const name = url.pathname.split("/")[3];
    let rows = (db[name] || []).map((row) =>
      name === "reps" && row.id === currentRep().id ? currentRep() : row,
    );
    if (req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const data = {
        id: "NEW-" + Date.now(),
        created_at: new Date().toISOString(),
        ...JSON.parse(body),
      };
      if (name === 'training_progress' && failTrainingCompletion && data.completed_at) {
        failTrainingCompletion = false;
        return send(res,{message:'Synthetic save failed; retry this draft.'},503);
      }
      writes.push({ table: name, data });
      db[name] ||= [];
      const old = name === 'training_progress' ? db[name].findIndex(row => row.rep_id === data.rep_id && row.item_id === data.item_id) : name==='feature_permissions'?db[name].findIndex(row=>row.role===data.role&&row.feature===data.feature):-1;
      if (old >= 0) db[name][old] = data; else db[name].push(data);
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
    if(name === 'lead_activity' && url.searchParams.get('select')?.includes('to_status:')) rows = rows.map(row=>({...row,to_status:row.metadata?.to_status}));
    const order = url.searchParams.get('order');
    if(order?.startsWith('created_at.desc')) rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
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
  async function screenshotFromTop(filename){
    await page.evaluate(()=>scrollTo(0,0));
    await page.waitForTimeout(100);
    await page.screenshot({path:path.join(artifacts,filename),fullPage:true});
  }
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
  if(!process.env.UI_DEEP_ONLY&&!process.env.UI_COACH_ONLY){
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
      await page.locator("#tnLessonsTab").click();
      await page.locator('[data-item="TRAIN-1"]').click();
      await page.locator("#tnTrainControls button").waitFor();
      await checkTutorial("training lesson");
    }
    if (route === "shifts") {
      await page.locator('.tnPersonBtn').first().waitFor();
      assert.equal(await page.locator('#shiftRetry').count(), 0, 'Shifts renders the successful board, not the retry state');
      // Secondary panels start collapsed on phones. Open the visible disclosure first.
      const dayToggle = page.locator('.tnFoldHead[aria-controls="tn-fold-shift-day"]');
      if (await dayToggle.getAttribute('aria-expanded') === 'false') await dayToggle.click();
      await page.locator('.tnPersonBtn').first().click();
      assert.ok((await page.locator('.tnMilesBig').innerText()).includes('1.3'), 'Shifts selection opens the person detail');
      await page.locator('#tnShiftBack').click();
    }
    console.log(route + " responsive widths passed");
  }

  await page.goto(origin + "/homeowner.html");
  await page.waitForURL("**/setter.html");
  console.log("legacy homeowner link reaches unified inspection form");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/");
  await page.locator("#workList .leadRow").first().waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.tnPins === "1");
  const autoPins = await page.evaluate(() => document.querySelectorAll(".pinCluster, .leaflet-interactive").length);
  assert.ok(autoPins > 0, "lead pins render on load without opening Layers");
  assert.equal(await page.locator('[data-layer="pins"]').isChecked(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#tnMore").click();
  const moreOnScreen = await page.evaluate(() => {
    const rect = document.getElementById("tnMoreMenu").getBoundingClientRect();
    return !document.getElementById("tnMoreMenu").hidden && rect.top >= 0 && rect.bottom <= innerHeight && rect.height > 80;
  });
  assert.equal(moreOnScreen, true, "More menu is on the phone screen");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await page.locator("#postSignInContinue").isVisible())
    await page.locator("#postSignInContinue").click();
  await page.locator("#routeBtn").click();
  await page.locator("#routeTray").waitFor({state:"visible"});
  assert.equal(await page.locator("#routeTray").evaluate(el=>!!el.closest('#listSheet')),true,'Route creation is in the side panel');
  assert.equal(await page.locator('.mapHud').evaluate(el=>el.open),false,'Field summary starts compact');
  assert.equal(await page.locator('#weatherStack').evaluate(el=>!!el.closest('.mapToolBtns')),true,'Weather joins the map buttons');
  await page.locator("#routeTrayBtn").click();
  await page.locator("#routePanel").waitFor({state:"visible"});
  assert.equal(await page.locator("#routePanel").evaluate(el=>!!el.closest('#listSheet')),true,'Optimization stays in the side panel');
  await page.keyboard.press("Escape");
  await page.locator("#routePanel").waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'routeTrayBtn');
  console.log("Unified route panel, compact field totals, weather placement and Escape focus passed");
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
  }
  if(!process.env.UI_MAP_ONLY){
    role='appointment_setter';
    db.training_progress=[]; // Isolate the Coach/save retry scenario from preceding lesson tutorials.
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(origin+'/training.html');
    await page.locator('#tnCoachInput').waitFor();
    assert.equal(await page.locator('#tnCoachTab').getAttribute('aria-selected'),'true');
    assert.ok((await page.locator('.tnCoachWelcome h2').innerText()).includes('Preview'));
    await page.evaluate(() => {
      class PreviewWebSocket {
        static OPEN = 1;
        constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
        send(raw) {
          const message = JSON.parse(raw);
          if (message.setup) setTimeout(() => this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) }), 0);
          if (message.clientContent) setTimeout(() => this.onmessage?.({ data: JSON.stringify({ serverContent: { outputTranscription: { text: 'Live Coach is ready.' }, turnComplete: true } }) }), 0);
        }
        close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
      }
      window.WebSocket = PreviewWebSocket;
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
      class PreviewAudioContext {
        constructor() { this.sampleRate = 16000; this.currentTime = 0; this.destination = {}; }
        createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
        createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
        createGain() { return { gain: { value: 0 }, connect() {} }; }
        createBuffer() { return { duration: 0, getChannelData: () => new Float32Array() }; }
        createBufferSource() { return { connect() {}, start() {} }; }
        close() { return Promise.resolve(); }
      }
      window.AudioContext = PreviewAudioContext;
    });
    await page.locator('#tnCoachLiveToggle').click();
    await page.locator('#tnCoachLiveStatus').filter({hasText:'Listening'}).waitFor();
    assert.equal(liveTokenCalls,1,'Live Coach requests an ephemeral token');
    assert.ok((await page.locator('#tnCoachLiveThread').innerText()).includes('Live Coach is ready.'));
    await page.locator('#tnCoachLiveToggle').click();
    await page.locator('#tnCoachLiveStatus').filter({hasText:'paused'}).waitFor();
    await page.locator('#tnCoachLiveToggle').click();
    await page.locator('#tnCoachLiveStatus').filter({hasText:'Listening'}).waitFor();
    await page.locator('#tnCoachLiveStop').click();
    await page.locator('#tnCoachLiveStatus').filter({hasText:'ready'}).waitFor();
    await page.locator('.tnCoachProfile summary').click();
    const profileText=await page.locator('.tnCoachStats').innerText();
    assert.match(profileText,/6\s+Field touches/,'Own field touches, excluding 140 other-user events');
    assert.match(profileText,/1\s+Upcoming inspections/,'Only the current user’s upcoming appointment');
    assert.match(profileText,/1\s+Photos added/,'Own photo count excludes other users');
    await page.locator('[data-coach-topic="plan"]').click();
    await page.locator('.tnCoachMessage.is-assistant').filter({hasText:'Practice reply:'}).waitFor();
    assert.ok(coachCalls.at(-1).body.topic==='plan');
    assert.equal(await page.locator('#tnCoachThread img').count(),0,'Model HTML is rendered as plain text');
    assert.ok((await page.locator('#tnCoachThread').innerText()).includes('<img src=x'),'The adversarial model payload reaches the transcript as text');
    assert.equal(await page.evaluate(()=>window.coachInjected),undefined);
    await page.locator('#tnCoachInput').fill('<svg onload="window.coachInjected=true">Help me practice');
    await page.locator('#tnCoachSend').click();
    await page.waitForFunction(()=>!document.getElementById('tnCoachSend').disabled);
    assert.equal(await page.locator('#tnCoachThread svg').count(),0,'User HTML is rendered as plain text');
    assert.equal(await page.evaluate(()=>window.coachInjected),undefined);
    assert.equal(coachCalls.at(-1).body.history.length,2,'Conversation carries only prior conversational turns');
    assert.equal('profile' in coachCalls.at(-1).body,false,'No caller-selected profile');
    await page.locator('#tnCoachReset').click();
    assert.equal(await page.locator('.tnCoachMessage').count(),1,'New conversation keeps only personal greeting');
    db.lead_photos.push({id:'OWN-PHOTO-2',uploaded_by:repId,lead_id:'TEST-2',created_at:isoHours(-0.5),storage_path:'preview.png'});
    await page.locator('#tnCoachRefresh').click();
    await page.locator('#tnCoachInput').waitFor();
    await page.locator('.tnCoachProfile summary').click();
    assert.match(await page.locator('.tnCoachStats').innerText(),/2\s+Photos added/,'Refresh reloads server-derived own data');
    await page.locator('.tnCoachProfile summary').click(); // Keep the first-impression screenshot compact.
    await screenshotFromTop('coach-desktop.png');
    await page.locator('#tnCoachTab').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tnLessonsTab').getAttribute('aria-selected'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'tnLessonsTab');
    await page.locator('[data-filter="required"]').click();
    assert.equal(await page.locator('[data-item="TRAIN-1"]').count(),1);
    await page.locator('[data-filter="pdf"]').click();
    assert.equal(await page.locator('[data-item]').count(),0);
    await page.locator('.tnTrainFilters [data-filter="all"]').click();
    failTrainingCompletion=true;
    await page.locator('[data-item="TRAIN-1"]').click();
    await page.locator('#tnTrainDone').waitFor();
    await page.locator('[data-training-retry]').waitFor();
    assert.ok(!(db.training_progress.find(row=>row.item_id==='TRAIN-1')?.completed_at),'Failed completion is not confirmed');
    await page.locator('[data-training-retry]').click();
    await page.locator('#tnTrainSaveStatus').filter({hasText:'Progress saved.'}).waitFor();
    assert.ok(db.training_progress.find(row=>row.item_id==='TRAIN-1')?.completed_at,'Retry confirms persisted lesson completion');
    await page.locator('#tnTrainBack').click();
    await page.locator('#tnLessonsTab').waitFor();
    assert.equal(await page.locator('#tnLessonsTab').getAttribute('aria-selected'),'true','Back returns to lessons');
    await page.setViewportSize({width:390,height:844});
    await screenshotFromTop('lessons-mobile.png');
    await page.locator('#tnLessonsTab').focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#tnCoachTab').getAttribute('aria-selected'),'true');
    await page.locator('#tnCoachInput').waitFor();
    await page.locator('#tnCoachReset').click();
    // Return to a freshly loading Coach while its reply is still in flight.
    async function waitFixture(predicate,label){const deadline=Date.now()+10000;while(!predicate()){assert.ok(Date.now()<deadline,label+' fixture request arrives');await page.waitForTimeout(20);}}
    let releasePost,releaseGet;
    coachPostGate=new Promise(resolve=>releasePost=resolve);
    await page.locator('#tnCoachInput').fill('Race request: help me plan a calm follow-up.');
    await page.locator('#tnCoachSend').click();
    await waitFixture(()=>coachCalls.at(-1)?.body?.message?.startsWith('Race request:'),'Pending coaching POST');
    await page.locator('#tnLessonsTab').click();
    await page.locator('[data-item="TRAIN-1"]').click();
    await page.locator('#tnTrainDone').waitFor();
    coachGetGate=new Promise(resolve=>releaseGet=resolve);
    await page.locator('#tnTrainBack').click();
    await waitFixture(()=>coachCalls.at(-1)?.method==='GET','Fresh coaching GET');
    releasePost();coachPostGate=null;
    await page.waitForTimeout(150);
    releaseGet();coachGetGate=null;
    await page.locator('#tnCoachTab').click();
    await page.locator('#tnCoachInput').waitFor();
    assert.equal(await page.locator('.tnCoachMessage').count(),3,'In-flight reply survives a return through a loading Coach');
    assert.ok((await page.locator('#tnCoachThread').innerText()).includes('Race request:'));
    assert.ok((await page.locator('#tnCoachThread').innerText()).includes('Practice reply:'));
    assert.equal(await page.locator('#tnCoachSend').isDisabled(),false);
    await page.locator('#tnCoachReset').click();
    coachPostGate=new Promise(resolve=>releasePost=resolve);
    failNextCoachPost=true;
    const retainedDraft='Keep this draft when my Coach request fails during navigation.';
    await page.locator('#tnCoachInput').fill(retainedDraft);
    await page.locator('#tnCoachSend').click();
    await waitFixture(()=>coachCalls.at(-1)?.body?.message===retainedDraft,'Pending failed coaching POST');
    await page.locator('#tnLessonsTab').click();
    await page.locator('[data-item="TRAIN-1"]').click();
    await page.locator('#tnTrainDone').waitFor();
    coachGetGate=new Promise(resolve=>releaseGet=resolve);
    await page.locator('#tnTrainBack').click();
    await waitFixture(()=>coachCalls.at(-1)?.method==='GET','Fresh coaching GET after failed POST');
    releasePost();coachPostGate=null;
    await page.waitForTimeout(150);
    releaseGet();coachGetGate=null;
    await page.locator('#tnCoachTab').click();
    await page.locator('#tnCoachInput').waitFor();
    assert.equal(await page.locator('#tnCoachInput').inputValue(),retainedDraft,'Failed in-flight message is restored after navigation');
    assert.ok((await page.locator('#tnCoachStatus').innerText()).includes('draft is retained'));
    assert.equal(await page.locator('.tnCoachMessage').count(),1,'Failed message is removed from transcript');
    await page.locator('#tnCoachReset').click();
    const beforePracticeWrites=writes.length,beforePracticeGeneration=coachGenerations;
    const lastReply=()=>page.locator('.tnCoachMessage.is-assistant').last();
    async function practiceMessage(message,phase){
      await page.locator('#tnCoachInput').fill(message);
      await page.locator('#tnCoachSend').click();
      await page.waitForFunction(()=>!document.getElementById('tnCoachSend').disabled);
      assert.ok((await lastReply().innerText()).includes('Practice · '+phase));
    }
    await page.locator('#tnCoachPracticeStart').click();
    await page.waitForFunction(()=>!document.getElementById('tnCoachSend').disabled);
    assert.ok((await lastReply().innerText()).includes('Practice · Introduction'));
    assert.equal(await page.locator('#tnCoachPracticeTools').isVisible(),true);
    await page.locator('#tnCoachHint').click();
    await page.waitForFunction(()=>!document.getElementById('tnCoachSend').disabled);
    assert.ok((await lastReply().innerText()).includes('Example to adapt:'));
    await practiceMessage('Hi, I’m Preview with True North. Is now an okay time for one quick question?','Respectful objection');
    assert.ok((await lastReply().innerText()).includes('You named True North clearly.'));
    await page.locator('#tnCoachRetryRound').click();
    await page.waitForFunction(()=>!document.getElementById('tnCoachSend').disabled);
    assert.ok((await lastReply().innerText()).includes('Practice · Introduction'));
    await practiceMessage('Hi, I’m Preview with True North. May I ask what matters most about your roof?','Respectful objection');
    await practiceMessage('I understand. Thank you for letting me know. Have a good day.','Clear next step');
    await page.locator('#tnCoachHint').click();
    await page.waitForFunction(()=>!document.getElementById('tnCoachSend').disabled);
    assert.ok((await lastReply().innerText()).includes('Example to adapt:'));
    await practiceMessage('If you’d like, we can discuss arranging an inspection. Would you like me to explain the visit?','Reflect and apply');
    await screenshotFromTop('coach-practice-mobile.png');
    await page.locator('#tnCoachPracticeStart').click();
    await page.waitForFunction(()=>!document.getElementById('tnCoachSend').disabled);
    await practiceMessage('Insurance will cover everything. You must sign now.','Respectful objection');
    assert.ok((await lastReply().innerText()).includes('Remove the certainty'));
    assert.ok((await lastReply().innerText()).includes('Remove the pressure'));
    assert.equal(writes.length,beforePracticeWrites,'Practice does not change app records');
    assert.equal(coachGenerations,beforePracticeGeneration,'Practice requires no model request');
    await page.locator('#tnCoachReset').click();
    assert.equal(await page.locator('#tnCoachPracticeTools').isVisible(),false);
    await page.locator('[data-coach-topic="confidence"]').click();
    await page.waitForFunction(()=>!document.getElementById('tnCoachSend').disabled);
    assert.ok((await page.locator('#tnCoachThread').innerText()).includes('Practice reply:'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Coach fits 390px mobile');
    await screenshotFromTop('coach-mobile.png');
    for(const width of [320,390,768,1024,1440]){
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Coach fits '+width+'px');
    }
    console.log('Authenticated Coach: own context, topics, plain-text safety, reset, refresh, keyboard tabs, lessons, failed-save retry, successful/failed pending-reply navigation races and full guided practice round passed (desktop + mobile).');
  }
  if(process.env.UI_COACH_ONLY){assert.deepEqual(errors,[],'No unhandled Coach browser errors');await browser.close();server.close();console.log('Focused Coach UI smoke passed.');return;}
  const controlAudit=[];
  async function reachable(selector,label){
    const control=typeof selector==='string'?page.locator(selector).first():selector;
    assert.ok(await control.isVisible(),label+' is displayed');
    await control.scrollIntoViewIfNeeded();
    const result=await control.evaluate(el=>{
      const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      const top=document.elementFromPoint(x,y);
      return {label:el.getAttribute('aria-label')||el.textContent.trim(),width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,container:el.parentElement.getBoundingClientRect().toJSON(),onScreen:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,uncovered:!!top&&(el===top||el.contains(top))};
    });
    controlAudit.push({page:await page.url(),viewport:page.viewportSize(),label,...result});
    if(!result.onScreen||!result.uncovered)await page.screenshot({path:path.join(artifacts,'control-failure.png')});
    assert.ok(result.onScreen&&result.uncovered,label+' is visible and uncovered: '+JSON.stringify(result));
    assert.ok(result.height>=43,label+' touch target: '+JSON.stringify(result));
  }
  if(!process.env.UI_MAP_ONLY){
  role='admin';
  await page.setViewportSize({width:390,height:844});
  await page.goto(origin+'/admin.html');
  await page.locator('#metrics .metric').first().waitFor();
  for(const tab of ['overview','team','accounts','features','appointments','homeowners','activity','territories','files','training']){
    await openManagement();
    await page.locator('.rail [data-tab='+tab+']').click();
    await page.locator('#tab-'+tab).waitFor({state:'visible'});
    assert.equal(await page.locator('.rail [data-tab='+tab+']').getAttribute('aria-controls'),'tab-'+tab);
  }
  await openManagement();
  await page.locator('.rail [data-tab=features]').click();
  await page.locator('#featureControls input').first().waitFor();
  assert.equal(await page.locator('#featureControls input').count(),22,'Two role switches for every field feature');
  const coachSwitch=page.locator('#featureControls input[data-role="appointment_setter"][data-feature="coach"]');
  await coachSwitch.uncheck();await page.locator('#featureNotice').filter({hasText:'Saved.'}).waitFor();
  await page.locator('.rail [data-tab=features]').click();await coachSwitch.waitFor();
  assert.equal(await coachSwitch.isChecked(),false,'Saved role permissions load again');
  await coachSwitch.check();await page.locator('#featureNotice').filter({hasText:'Saved.'}).waitFor();
  await page.locator('.rail [data-tab=overview]').click();
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(artifacts,'revamp-admin-mobile.png')});
  await page.locator('.workspaceMenuBtn').click();
  await reachable('.workspaceNav a[data-workspace-link="map"]','Management mobile map link');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.className),'workspaceMenuBtn');
  await page.locator('.atlasJump').click();
  await page.locator('#atlasCommandQuery').fill('appointments');
  assert.equal(await page.locator('.atlasCommandResult').first().getAttribute('href'),'/admin.html#appointments');
  await page.keyboard.press('Enter');
  await page.locator('#tab-appointments').waitFor({state:'visible'});
  console.log('All management tabs and page-search deep links passed');
  for(const nextRole of ['appointment_setter','salesperson','manager','admin']){
    role=nextRole;
    await page.goto(origin+'/account.html');
    await page.locator('.profileHero').waitFor();
    await page.locator('.atlasJump').click();
    await page.locator('#atlasCommandQuery').fill('roof photos');
    assert.equal(await page.locator('.atlasCommandResult').count(),nextRole==='appointment_setter'?0:1,nextRole+' photo permission');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.locator('#atlasCommandQuery').fill('book');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.className),'atlasCommandResult');
    await page.keyboard.press('Escape');
    for(const width of [320,390,768,1024,1440]){
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>scrollTo(0,0));
      await reachable('.atlasJump',nextRole+' page search at '+width);
      await reachable('#tnPageHelp',nextRole+' help at '+width);
      if(width<=1100)await reachable('.workspaceMenuBtn',nextRole+' menu at '+width);
    }
  }
  const inventories=[];
  for(const route of ['account','setter','rep','forms','files','training','photo','shifts','reset-password','form-print']){
    role='admin';
    const query=route==='photo'?'?lead=TEST-2':route==='form-print'?'?id=FORM-1':'';
    await page.goto(origin+'/'+route+'.html'+query);
    await page.waitForTimeout(350);
    for(const width of [390,1440]){
      await page.setViewportSize({width,height:900});
      for(let round=0;round<4;round++){
        let opened=false;
        for(const head of await page.locator('.tnFoldHead[aria-expanded="false"]').all()){
          if(await head.isVisible()&&!await head.evaluate(el=>!!el.closest('[inert]'))){await head.click();opened=true;}
        }
        if(!opened)break;
      }
      for(const control of await page.locator('main button, .container button').all()){
        if(await control.isVisible()&&!await control.evaluate(el=>!!el.closest('[inert]')))await reachable(control,route+' visible button at '+width);
      }
      inventories.push({route,width,buttons:await page.locator('button').evaluateAll(items=>items.map(el=>({id:el.id,label:el.getAttribute('aria-label')||el.textContent.trim(),visible:!!el.getClientRects().length&&!el.closest('[inert]'),disabled:el.disabled})))});
      await page.evaluate(()=>scrollTo(0,0));
      if(width===390)await page.screenshot({path:path.join(artifacts,'revamp-'+route+'-mobile.png')});
    }
    console.log(route+' visible content buttons checked');
  }
  fs.writeFileSync(path.join(artifacts,'button-inventory.json'),JSON.stringify(inventories,null,2));
  }
  role='admin';
  await page.goto(origin+'/');
  await page.locator('#workList .leadRow').first().waitFor();
  if(await page.locator('#postSignInContinue').isVisible())await page.locator('#postSignInContinue').click();
  await page.locator('#mapLoader').waitFor({state:'hidden'});
  for(const [width,height] of (process.env.UI_WIDTH?[[Number(process.env.UI_WIDTH),800]]:[[320,568],[390,844],[768,900],[1024,800],[1440,900],[1920,1080],[844,390]])){
    console.log('Map control audit',width,height);
    await page.setViewportSize({width,height});
    await page.waitForTimeout(200);
    if(width<=960&&await page.locator('#listSheet').evaluate(el=>el.classList.contains('panel-open')))await page.locator('#listSheetGrab').click();
    for(const id of ['filterBtn','legendKey','fitBtn','weatherToggle','layerBtn','routeBtn','tnPageHelp'])await reachable('#'+id,'Map '+id+' at '+width+'x'+height);
    await page.locator('#layerBtn').click();
    assert.equal(await page.locator('#layerBtn').getAttribute('aria-expanded'),'true');
    await page.locator('[data-layer="density"]').check();
    await page.locator('[data-layer="density"]').uncheck();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#layerBtn').getAttribute('aria-expanded'),'false');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'layerBtn');
    await page.locator('#filterBtn').click();
    await page.locator('#statusFilter').selectOption('New');
    await page.locator('#clearBtn').click();
    assert.equal(await page.locator('#statusFilter').inputValue(),'');
    await page.locator('#layerBtn').click();
    assert.equal(await page.locator('#filterPanel').isVisible(),false,'Only one popover open');
    await page.keyboard.press('Escape');
    await page.locator('#fitBtn').click();
    if(width<=1100){
      await page.locator('#tnMore').click();
      await reachable('#tnMoreMenu [data-tn-action="signout"]','Phone sign out '+width);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'tnMore');
    }
    await page.locator('#routeBtn').click();
    await page.locator('#routeTrayToggle').click();
    if(await page.locator('#routeTrayToggle').getAttribute('aria-expanded')!=='true')await page.locator('#routeTrayToggle').click();
    for(const id of ['selectVisibleBtn','trayDrive','trayWalk','clearRouteBtn','routeTrayBtn','startRouteBtn'])await reachable('#'+id,'Route '+id+' at '+width+'x'+height);
    if(width===390)await page.screenshot({path:path.join(artifacts,'revamp-mobile-map.png')});
    await reachable('#routeTrayExtras summary','More route tools at '+width+'x'+height);
    await page.locator('#routeTrayExtras summary').click();
    assert.equal(await page.locator('#routeTrayExtras').evaluate(el=>el.open),true,'Route tools disclosure opens');
    for(const id of ['drawAreaTrayBtn','stormHousesBtn'])await reachable('#'+id,'Secondary route '+id+' at '+width+'x'+height);
    await page.locator('#routeTrayExtras summary').click();
    assert.equal(await page.locator('#routeTrayExtras').evaluate(el=>el.open),false,'Route tools disclosure closes');
    await page.locator('#routeTrayToggle').click();
    if(width===390)await page.screenshot({path:path.join(artifacts,'revamp-mobile-map-collapsed.png')});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.waitForTimeout(200);
  await page.locator('#routeBtn').click();
  await page.locator('#routeTrayToggle').click();
  if(await page.locator('#routeTrayToggle').getAttribute('aria-expanded')!=='true')await page.locator('#routeTrayToggle').click();
  await page.locator('#selectVisibleBtn').click();
  assert.ok(Number(await page.locator('#selectedCount').innerText())>0,'Route selection works');
  await page.locator('#clearRouteBtn').click();
  await page.locator('#selectedCount').filter({hasText:/^0$/}).waitFor();
  const routeIds=await page.locator('#workList .rowCheck').evaluateAll(items=>items.slice(0,2).map(el=>el.dataset.id));
  assert.equal(routeIds.length,2,'Two sample houses available');
  for(const id of routeIds)await page.locator('#workList .rowCheck[data-id="'+id+'"]').check();
  assert.equal(await page.locator('#selectedCount').innerText(),'2','Both route houses selected');
  await page.locator('#routeTrayBtn').click();
  await page.locator('#optimizeRouteBtn').click();
  await page.locator('#routeDistance').filter({hasText:'road-network optimized'}).waitFor();
  assert.ok(await page.locator('.routeStop').count()>0,'Mocked route optimization renders stops');
  await page.screenshot({path:path.join(artifacts,'revamp-desktop-route.png')});
  await page.locator('#closeRoute').click();
  await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:()=>1,clearWatch:()=>{},getCurrentPosition:success=>success({coords:{latitude:40.39,longitude:-82.48,accuracy:10}})}}));
  await page.locator('#startRouteBtn').click();
  await page.locator('#navInApp').click();
  await page.locator('#navBar').waitFor({state:'visible'});
  assert.equal(await page.locator('#navBar').evaluate(el=>el.parentElement.classList.contains('mapShell')),true,'Active fullscreen guidance remains reachable');
  await page.locator('#navEnd').click();
  assert.equal(await page.locator('#navBar').evaluate(el=>!!el.closest('#listSheet')),true,'Navigation returns to the unified planning panel');
  await page.locator('#routeTrayBtn').click();
  while(await page.locator('.routeStop button').count()){
    const count=await page.locator('.routeStop button').count();
    await page.locator('.routeStop button').first().click();
    await page.waitForFunction(expected=>document.querySelectorAll('.routeStop button').length===expected,count-1);
  }
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#selectedCount').innerText(),'0','Removing the final stop clears selection');
  assert.ok((await page.locator('#routeStops').innerText()).includes('No route yet.'),'Removing the final stop clears the route');
  assert.equal(await page.locator('#openGoogleRouteBtn').isDisabled(),true);
  await page.locator('#closeRoute').click();
  await page.locator('#selectVisibleBtn').click();
  await page.locator('#clearRouteBtn').click();
  await page.locator('#selectedCount').filter({hasText:/^0$/}).waitFor();
  assert.equal(await page.locator('#selectedCount').innerText(),'0');
  assert.equal(await page.locator('#startRouteBtn').isDisabled(),true,'Empty route clearly unavailable');
  await page.locator('#routeTrayBtn').click();
  assert.equal(await page.locator('#optimizeRouteBtn').isDisabled(),true);
  assert.equal(await page.locator('#openGoogleRouteBtn').isDisabled(),true);
  await page.keyboard.press('Escape');
  await page.screenshot({path:path.join(artifacts,'revamp-desktop-map.png')});
  fs.writeFileSync(path.join(artifacts,'control-audit.json'),JSON.stringify(controlAudit,null,2));
  console.log('Visibility/hit tests passed for '+controlAudit.length+' controls; routing/filter/menu actions passed');
  if(!process.env.UI_DEEP_ONLY&&!process.env.UI_COACH_ONLY){

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
  }
  assert.deepEqual(errors, [], "No unhandled browser errors");
  console.log("UI smoke passed. Screenshots: " + artifacts);
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
