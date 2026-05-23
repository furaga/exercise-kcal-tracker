const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const storeKey = "training-log-v3";
const supabaseUrl = "https://lavpmdrjwtsbsxumfnon.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhdnBtZHJqd3RzYnN4dW1mbm9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjI0NzcsImV4cCI6MjA5NTA5ODQ3N30.fVSQoXxRRiF_iGJn8gREfCgZPgbM-BMT07dXLzWlibA";
const referenceWeightKg = 57.5;
const supabaseClient =
  window.supabase?.createClient?.(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }) || null;

let currentUser = null;
let cloudReady = false;
let cloudSyncTimer = null;
let suppressCloudSync = false;

const defaultStrengthRates = {
  latPulldown: { label: "ラットプルダウン", kcalPerRep: 0.32, kcalPerMinute: 1.6 },
  pushup: { label: "腕立て伏せ", kcalPerRep: 0.28, kcalPerMinute: 1.8 },
  chestPress: { label: "チェストプレス", kcalPerRep: 0.32, kcalPerMinute: 1.6 },
  shoulderPress: { label: "ショルダープレス", kcalPerRep: 0.3, kcalPerMinute: 1.6 },
  legPress: { label: "レッグプレス", kcalPerRep: 0.45, kcalPerMinute: 1.9 },
};

const defaultCardioRates = {
  step: { label: "踏み台昇降", kcalPerMinute: 5.0 },
  running: { label: "ランニング", kcalPerMinute: 7.2 },
  walking: { label: "ウォーキング", kcalPerMinute: 3.4 },
  bike: { label: "エアロバイク", kcalPerMinute: 4.8 },
};

const elements = {
  todayBadge: $("#todayBadge"),
  allCalories: $("#allCalories"),
  authStatus: $("#authStatus"),
  emailInput: $("#emailInput"),
  signInButton: $("#signInButton"),
  signOutButton: $("#signOutButton"),
  signedOutControls: $("#signedOutControls"),
  todayCalories: $("#todayCalories"),
  weekCalories: $("#weekCalories"),
  monthCalories: $("#monthCalories"),
  loggedDays: $("#loggedDays"),
  entryDate: $("#entryDate"),
  bodyWeight: $("#bodyWeight"),
  saveWeightButton: $("#saveWeightButton"),
  strengthForm: $("#strengthForm"),
  cardioForm: $("#cardioForm"),
  strengthName: $("#strengthName"),
  strengthDuration: $("#strengthDuration"),
  strengthRateNote: $("#strengthRateNote"),
  setList: $("#setList"),
  addSetButton: $("#addSetButton"),
  copyLastSetButton: $("#copyLastSetButton"),
  strengthReps: $("#strengthReps"),
  strengthMinutes: $("#strengthMinutes"),
  strengthCalories: $("#strengthCalories"),
  cardioName: $("#cardioName"),
  cardioMinutes: $("#cardioMinutes"),
  cardioRateNote: $("#cardioRateNote"),
  cardioRate: $("#cardioRate"),
  cardioPreviewMinutes: $("#cardioPreviewMinutes"),
  cardioCalories: $("#cardioCalories"),
  statusText: $("#statusText"),
  rateEditor: $("#rateEditor"),
  resetRatesButton: $("#resetRatesButton"),
  dailyList: $("#dailyList"),
  historyList: $("#historyList"),
  seedButton: $("#seedButton"),
  exportButton: $("#exportButton"),
};

const formatBadge = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

const formatShortDate = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
});

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultRates() {
  return {
    strength: clone(defaultStrengthRates),
    cardio: clone(defaultCardioRates),
  };
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(key, amount) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

function startOfWeek(key) {
  const date = dateFromKey(key);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return localDate(date);
}

function startOfMonth(key) {
  return `${key.slice(0, 7)}-01`;
}

function emptyStore() {
  return { weights: {}, workouts: [], rates: defaultRates() };
}

function readStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey) || "{}");
    return {
      weights: parsed.weights || {},
      workouts: Array.isArray(parsed.workouts) ? parsed.workouts : [],
      rates: {
        strength: { ...defaultRates().strength, ...(parsed.rates?.strength || {}) },
        cardio: { ...defaultRates().cardio, ...(parsed.rates?.cardio || {}) },
      },
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  localStorage.setItem(storeKey, JSON.stringify(store));
  scheduleCloudSync();
}

function writeLocalStore(store) {
  localStorage.setItem(storeKey, JSON.stringify(store));
}

function scheduleCloudSync() {
  if (!currentUser || !cloudReady || suppressCloudSync) return;
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => {
    syncCloud().catch((error) => {
      setAuthStatus(`クラウド同期に失敗: ${error.message}`);
    });
  }, 500);
}

function selectedDate() {
  return elements.entryDate.value || localDate();
}

function numberFromInput(input) {
  const value = Number(input.value);
  return Number.isFinite(value) && input.value !== "" ? value : null;
}

function setStatus(message, tone = "normal") {
  elements.statusText.textContent = message;
  elements.statusText.dataset.tone = tone;
}

function roundKcal(value) {
  return Math.round(value || 0);
}

function fixed(value, digits = 2) {
  return Number(value || 0).toFixed(digits).replace(/\.?0+$/, "");
}

function latestWeightOn(dateKey = selectedDate()) {
  const weights = readStore().weights;
  const candidates = Object.keys(weights)
    .filter((date) => date <= dateKey)
    .sort()
    .reverse();
  const date = candidates[0] || Object.keys(weights).sort().reverse()[0];
  if (!date) return null;
  return { date, value: Number(weights[date]) };
}

function setAuthStatus(message) {
  if (elements.authStatus) {
    elements.authStatus.textContent = message;
  }
}

function updateAuthUi() {
  const signedIn = Boolean(currentUser);
  elements.signedOutControls?.classList.toggle("hidden", signedIn);
  elements.signOutButton?.classList.toggle("hidden", !signedIn);
  setAuthStatus(
    signedIn
      ? `${currentUser.email || "ログイン中"}: Supabaseに同期します。`
      : "未ログイン: この端末内に保存します。",
  );
}

function redirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function signInWithEmail() {
  if (!supabaseClient) {
    setAuthStatus("Supabaseライブラリを読み込めませんでした。");
    return;
  }
  const email = elements.emailInput.value.trim();
  if (!email) {
    setAuthStatus("メールアドレスを入力してください。");
    return;
  }

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl() },
  });
  if (error) {
    setAuthStatus(`ログインリンク送信に失敗: ${error.message}`);
    return;
  }
  setAuthStatus("ログインリンクを送信しました。メールを確認してください。");
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
  cloudReady = false;
  updateAuthUi();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeStoreForCloud(store) {
  let changed = false;
  const workouts = store.workouts.map((workout) => {
    if (isUuid(workout.id)) return workout;
    changed = true;
    return { ...workout, id: uuid() };
  });
  if (changed) {
    const next = { ...store, workouts };
    writeLocalStore(next);
    return next;
  }
  return store;
}

function workoutToRow(workout) {
  return {
    id: workout.id,
    user_id: currentUser.id,
    date: workout.date,
    mode: workout.mode,
    key: workout.key,
    name: workout.name,
    calories: workout.calories || 0,
    minutes: workout.minutes ?? null,
    reps: workout.reps ?? null,
    volume: workout.volume ?? null,
    sets: workout.sets ?? null,
    base_rate: workout.baseRate ?? null,
    effective_rate: workout.effectiveRate ?? null,
    body_weight: workout.bodyWeight ?? null,
    created_at: workout.createdAt || new Date().toISOString(),
  };
}

function rowToWorkout(row) {
  return {
    id: row.id,
    date: row.date,
    mode: row.mode,
    key: row.key,
    name: row.name,
    calories: Number(row.calories || 0),
    minutes: row.minutes === null ? null : Number(row.minutes),
    reps: row.reps === null ? null : Number(row.reps),
    volume: row.volume === null ? null : Number(row.volume),
    sets: row.sets || [],
    baseRate: row.base_rate || {},
    effectiveRate: row.effective_rate || row.base_rate || {},
    bodyWeight: row.body_weight === null ? null : Number(row.body_weight),
    createdAt: row.created_at,
  };
}

function ratesToRows(rates) {
  const rows = [];
  Object.entries(rates.strength).forEach(([key, rate]) => {
    rows.push({
      user_id: currentUser.id,
      exercise_type: "strength",
      exercise_key: key,
      label: rate.label,
      kcal_per_rep: rate.kcalPerRep,
      kcal_per_minute: rate.kcalPerMinute,
    });
  });
  Object.entries(rates.cardio).forEach(([key, rate]) => {
    rows.push({
      user_id: currentUser.id,
      exercise_type: "cardio",
      exercise_key: key,
      label: rate.label,
      kcal_per_rep: null,
      kcal_per_minute: rate.kcalPerMinute,
    });
  });
  return rows;
}

function rowToRates(rows) {
  const rates = defaultRates();
  rows.forEach((row) => {
    if (row.exercise_type === "strength") {
      rates.strength[row.exercise_key] = {
        label: row.label,
        kcalPerRep: Number(row.kcal_per_rep || 0),
        kcalPerMinute: Number(row.kcal_per_minute || 0),
      };
    } else if (row.exercise_type === "cardio") {
      rates.cardio[row.exercise_key] = {
        label: row.label,
        kcalPerMinute: Number(row.kcal_per_minute || 0),
      };
    }
  });
  return rates;
}

async function deleteMissingRows(table, keyColumn, localKeys) {
  const { data, error } = await supabaseClient.from(table).select(keyColumn);
  if (error) throw error;
  const local = new Set(localKeys);
  for (const row of data || []) {
    const value = row[keyColumn];
    if (!local.has(value)) {
      const { error: deleteError } = await supabaseClient.from(table).delete().eq(keyColumn, value);
      if (deleteError) throw deleteError;
    }
  }
}

async function syncCloud() {
  if (!supabaseClient || !currentUser || !cloudReady) return;
  const store = normalizeStoreForCloud(readStore());
  setAuthStatus("Supabaseに同期中...");

  await deleteMissingRows("workouts", "id", store.workouts.map((workout) => workout.id));
  if (store.workouts.length) {
    const { error } = await supabaseClient.from("workouts").upsert(store.workouts.map(workoutToRow));
    if (error) throw error;
  }

  await deleteMissingRows("weights", "date", Object.keys(store.weights));
  const weightRows = Object.entries(store.weights).map(([date, weight]) => ({
    user_id: currentUser.id,
    date,
    weight_kg: weight,
  }));
  if (weightRows.length) {
    const { error } = await supabaseClient
      .from("weights")
      .upsert(weightRows, { onConflict: "user_id,date" });
    if (error) throw error;
  }

  const { error: rateError } = await supabaseClient
    .from("exercise_rates")
    .upsert(ratesToRows(store.rates), { onConflict: "user_id,exercise_type,exercise_key" });
  if (rateError) throw rateError;

  setAuthStatus(`${currentUser.email || "ログイン中"}: 同期済み`);
}

async function loadCloudStore() {
  const [workoutsResult, weightsResult, ratesResult] = await Promise.all([
    supabaseClient.from("workouts").select("*").order("date", { ascending: true }),
    supabaseClient.from("weights").select("*").order("date", { ascending: true }),
    supabaseClient.from("exercise_rates").select("*"),
  ]);

  if (workoutsResult.error) throw workoutsResult.error;
  if (weightsResult.error) throw weightsResult.error;
  if (ratesResult.error) throw ratesResult.error;

  const local = readStore();
  const remoteWeights = {};
  (weightsResult.data || []).forEach((row) => {
    remoteWeights[row.date] = Number(row.weight_kg);
  });
  const remoteWorkouts = (workoutsResult.data || []).map(rowToWorkout);
  const remoteRates = rowToRates(ratesResult.data || []);
  const remoteWorkoutIds = new Set(remoteWorkouts.map((workout) => workout.id));

  return {
    weights: { ...local.weights, ...remoteWeights },
    workouts: [
      ...remoteWorkouts,
      ...local.workouts.filter((workout) => !remoteWorkoutIds.has(workout.id)),
    ],
    rates: {
      strength: { ...local.rates.strength, ...remoteRates.strength },
      cardio: { ...local.rates.cardio, ...remoteRates.cardio },
    },
  };
}

async function loadUserData() {
  if (!currentUser) return;
  cloudReady = false;
  setAuthStatus("Supabaseから読み込み中...");
  try {
    const mergedStore = await loadCloudStore();
    suppressCloudSync = true;
    writeLocalStore(mergedStore);
    suppressCloudSync = false;
    populateExerciseOptions();
    renderRateEditor();
    renderAll();
    cloudReady = true;
    await syncCloud();
  } catch (error) {
    cloudReady = false;
    setAuthStatus(`Supabase読み込みに失敗: ${error.message}`);
  }
}

async function initAuth() {
  if (!supabaseClient) {
    setAuthStatus("Supabaseライブラリを読み込めませんでした。");
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;
  updateAuthUi();
  if (currentUser) {
    await loadUserData();
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    const nextUser = session?.user || null;
    if (nextUser?.id === currentUser?.id) return;
    currentUser = nextUser;
    updateAuthUi();
    if (currentUser) {
      loadUserData();
    } else {
      cloudReady = false;
      renderAll();
    }
  });
}

function activeBodyWeight() {
  return numberFromInput(elements.bodyWeight) || latestWeightOn(selectedDate())?.value || referenceWeightKg;
}

function weightFactor() {
  return activeBodyWeight() / referenceWeightKg;
}

function adjustedRate(rate) {
  const factor = weightFactor();
  return {
    ...rate,
    kcalPerRep: rate.kcalPerRep === undefined ? undefined : rate.kcalPerRep * factor,
    kcalPerMinute: rate.kcalPerMinute * factor,
    weightFactor: factor,
    bodyWeight: activeBodyWeight(),
  };
}

function weightNote() {
  const weight = activeBodyWeight();
  if (Math.abs(weight - referenceWeightKg) < 0.05) return `基準${referenceWeightKg}kg`;
  return `${fixed(weight, 1)}kg補正 x${fixed(weight / referenceWeightKg, 2)}`;
}

function populateExerciseOptions() {
  const store = readStore();
  elements.strengthName.textContent = "";
  Object.entries(store.rates.strength).forEach(([key, rate]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = rate.label;
    elements.strengthName.append(option);
  });

  elements.cardioName.textContent = "";
  Object.entries(store.rates.cardio).forEach(([key, rate]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = rate.label;
    elements.cardioName.append(option);
  });
}

function parseSets() {
  return $$(".set-row")
    .map((row) => ({
      weight: Number(row.querySelector('[data-field="weight"]').value),
      reps: Number(row.querySelector('[data-field="reps"]').value),
    }))
    .filter((set) => Number.isFinite(set.weight) && set.weight >= 0 && Number.isFinite(set.reps) && set.reps > 0);
}

function totalReps(sets) {
  return sets.reduce((sum, set) => sum + set.reps, 0);
}

function estimatedStrengthMinutes(sets) {
  if (!sets.length) return 0;
  const reps = totalReps(sets);
  const activeMinutes = Math.max(1, reps * 0.055);
  const restMinutes = Math.max(0, sets.length - 1) * 1.4;
  return Math.round((activeMinutes + restMinutes + 1.5) * 10) / 10;
}

function strengthVolume(sets) {
  return sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
}

function strengthEstimate() {
  const store = readStore();
  const sets = parseSets();
  const baseRate = store.rates.strength[elements.strengthName.value];
  const rate = adjustedRate(baseRate);
  const manualMinutes = numberFromInput(elements.strengthDuration);
  const minutes = manualMinutes || estimatedStrengthMinutes(sets);
  const reps = totalReps(sets);
  const calories = reps * rate.kcalPerRep + minutes * rate.kcalPerMinute;
  return { sets, baseRate, rate, minutes, reps, calories, volume: strengthVolume(sets) };
}

function cardioEstimate() {
  const store = readStore();
  const baseRate = store.rates.cardio[elements.cardioName.value];
  const rate = adjustedRate(baseRate);
  const minutes = numberFromInput(elements.cardioMinutes) || 0;
  const calories = minutes * rate.kcalPerMinute;
  return { baseRate, rate, minutes, calories };
}

function addSetRow(weight = "", reps = "") {
  const row = document.createElement("div");
  row.className = "set-row";

  const number = document.createElement("div");
  number.className = "set-number";

  const weightLabel = document.createElement("label");
  const weightText = document.createElement("span");
  const weightInput = document.createElement("input");
  weightText.textContent = "重量 kg";
  weightInput.type = "number";
  weightInput.min = "0";
  weightInput.max = "1000";
  weightInput.step = "0.5";
  weightInput.inputMode = "decimal";
  weightInput.dataset.field = "weight";
  weightInput.value = weight;
  weightLabel.append(weightText, weightInput);

  const repsLabel = document.createElement("label");
  const repsText = document.createElement("span");
  const repsInput = document.createElement("input");
  repsText.textContent = "回数";
  repsInput.type = "number";
  repsInput.min = "1";
  repsInput.max = "500";
  repsInput.step = "1";
  repsInput.inputMode = "numeric";
  repsInput.dataset.field = "reps";
  repsInput.value = reps;
  repsLabel.append(repsText, repsInput);

  const remove = document.createElement("button");
  remove.className = "remove-set-button";
  remove.type = "button";
  remove.title = "削除";
  remove.textContent = "x";
  remove.addEventListener("click", () => {
    row.remove();
    renumberSets();
    renderPreviews();
  });

  row.append(number, weightLabel, repsLabel, remove);
  row.addEventListener("input", renderPreviews);
  elements.setList.append(row);
  renumberSets();
  renderPreviews();
}

function renumberSets() {
  $$(".set-row").forEach((row, index) => {
    row.querySelector(".set-number").textContent = String(index + 1);
  });
}

function renderPreviews() {
  const strength = strengthEstimate();
  elements.strengthRateNote.textContent =
    `${strength.rate.label}: 基準 ${fixed(strength.baseRate.kcalPerRep)} kcal/回 + ` +
    `${fixed(strength.baseRate.kcalPerMinute)} kcal/分 -> 補正後 ` +
    `${fixed(strength.rate.kcalPerRep)} kcal/回 + ${fixed(strength.rate.kcalPerMinute)} kcal/分 (${weightNote()})`;
  elements.strengthReps.textContent = String(strength.reps);
  elements.strengthMinutes.textContent = String(strength.minutes);
  elements.strengthCalories.textContent = String(roundKcal(strength.calories));

  const cardio = cardioEstimate();
  elements.cardioRateNote.textContent =
    `${cardio.rate.label}: 基準 ${fixed(cardio.baseRate.kcalPerMinute)} kcal/分 -> ` +
    `補正後 ${fixed(cardio.rate.kcalPerMinute)} kcal/分 (${weightNote()})`;
  elements.cardioRate.textContent = fixed(cardio.rate.kcalPerMinute);
  elements.cardioPreviewMinutes.textContent = String(cardio.minutes);
  elements.cardioCalories.textContent = String(roundKcal(cardio.calories));
}

function workoutsBetween(startKey, endKey) {
  return readStore().workouts.filter((workout) => workout.date >= startKey && workout.date <= endKey);
}

function sumCalories(workouts) {
  return workouts.reduce((sum, workout) => sum + (workout.calories || 0), 0);
}

function loggedDates(workouts) {
  return new Set(workouts.map((workout) => workout.date));
}

function renderSummary() {
  const today = localDate();
  const store = readStore();
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);
  const todayWorkouts = workoutsBetween(today, today);
  const weekWorkouts = workoutsBetween(weekStart, today);
  const monthWorkouts = workoutsBetween(monthStart, today);

  elements.allCalories.textContent = String(roundKcal(sumCalories(store.workouts)));
  elements.todayCalories.textContent = String(roundKcal(sumCalories(todayWorkouts)));
  elements.weekCalories.textContent = String(roundKcal(sumCalories(weekWorkouts)));
  elements.monthCalories.textContent = String(roundKcal(sumCalories(monthWorkouts)));
  elements.loggedDays.textContent = String(loggedDates(store.workouts).size);
}

function renderDailyList() {
  const store = readStore();
  const byDate = new Map();
  store.workouts.forEach((workout) => {
    const group = byDate.get(workout.date) || [];
    group.push(workout);
    byDate.set(workout.date, group);
  });

  const dates = Array.from(byDate.keys()).sort().reverse();
  const maxCalories = Math.max(1, ...dates.map((date) => sumCalories(byDate.get(date))));
  elements.dailyList.textContent = "";

  if (!dates.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "まだ記録はありません。種目を保存すると日ごとの消費カロリーが見えます。";
    elements.dailyList.append(empty);
    return;
  }

  dates.slice(0, 30).forEach((date) => {
    const workouts = byDate.get(date);
    const calories = sumCalories(workouts);
    const item = document.createElement("article");
    item.className = "daily-item";

    const head = document.createElement("div");
    head.className = "daily-head";
    const dateLabel = document.createElement("strong");
    dateLabel.textContent = formatShortDate.format(dateFromKey(date));
    const kcal = document.createElement("span");
    kcal.textContent = `${roundKcal(calories)} kcal`;
    head.append(dateLabel, kcal);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.setProperty("--bar", `${(calories / maxCalories) * 100}%`);
    track.append(fill);

    const chips = document.createElement("div");
    chips.className = "exercise-chips";
    workouts.forEach((workout) => {
      const chip = document.createElement("span");
      chip.textContent = workout.name;
      chips.append(chip);
    });

    item.append(head, track, chips);
    elements.dailyList.append(item);
  });
}

function workoutDetail(workout) {
  if (workout.mode === "cardio") {
    return `${workout.minutes}分 / ${fixed(workout.effectiveRate.kcalPerMinute)} kcal/分 / ${roundKcal(workout.calories)} kcal`;
  }
  const sets = workout.sets.map((set) => `${set.weight}kg x ${set.reps}`).join(" / ");
  return `${sets} / ${workout.reps}回 / ${workout.minutes}分 / ` +
    `${fixed(workout.effectiveRate.kcalPerRep)} kcal/回 + ${fixed(workout.effectiveRate.kcalPerMinute)} kcal/分 / ` +
    `${roundKcal(workout.calories)} kcal`;
}

function renderHistory() {
  const workouts = readStore().workouts.slice().sort((a, b) => {
    if (a.date === b.date) return (b.createdAt || "").localeCompare(a.createdAt || "");
    return b.date.localeCompare(a.date);
  });

  elements.historyList.textContent = "";
  if (!workouts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "まだ運動履歴はありません。筋トレか有酸素を保存するとここに並びます。";
    elements.historyList.append(empty);
    return;
  }

  workouts.slice(0, 50).forEach((workout) => {
    const item = document.createElement("article");
    item.className = "history-item";

    const content = document.createElement("div");
    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = workout.name;

    const meta = document.createElement("span");
    meta.textContent = `${formatShortDate.format(dateFromKey(workout.date))} ${workout.mode === "strength" ? "筋トレ" : "有酸素"}`;
    title.append(meta);

    const detail = document.createElement("p");
    detail.className = "history-detail";
    detail.textContent = workoutDetail(workout);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "削除";
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      const store = readStore();
      store.workouts = store.workouts.filter((item) => item.id !== workout.id);
      writeStore(store);
      renderAll();
    });

    content.append(title, detail);
    item.append(content, remove);
    elements.historyList.append(item);
  });
}

function renderRateEditor() {
  const store = readStore();
  elements.rateEditor.textContent = "";

  const note = document.createElement("p");
  note.className = "rate-help";
  note.textContent = `係数は基準${referenceWeightKg}kgの値です。体重メモがある日は入力体重に合わせて自動補正します。`;
  elements.rateEditor.append(note);

  const groups = [
    ["strength", "筋トレ", "基準kcal/回", "基準kcal/分"],
    ["cardio", "有酸素", null, "基準kcal/分"],
  ];

  groups.forEach(([type, label, repLabel, minuteLabel]) => {
    const group = document.createElement("section");
    group.className = "rate-group";
    const heading = document.createElement("h3");
    heading.textContent = label;
    group.append(heading);

    Object.entries(store.rates[type]).forEach(([key, rate]) => {
      const row = document.createElement("div");
      row.className = "rate-row";

      const name = document.createElement("strong");
      name.textContent = rate.label;
      row.append(name);

      if (repLabel) {
        row.append(rateInput(type, key, "kcalPerRep", repLabel, rate.kcalPerRep));
      }
      row.append(rateInput(type, key, "kcalPerMinute", minuteLabel, rate.kcalPerMinute));
      group.append(row);
    });

    elements.rateEditor.append(group);
  });
}

function rateInput(type, key, field, labelText, value) {
  const label = document.createElement("label");
  const span = document.createElement("span");
  const input = document.createElement("input");
  span.textContent = labelText;
  input.type = "number";
  input.min = "0";
  input.max = "100";
  input.step = "0.05";
  input.inputMode = "decimal";
  input.value = value;
  input.addEventListener("input", () => {
    const store = readStore();
    const next = Number(input.value);
    if (Number.isFinite(next) && next >= 0) {
      store.rates[type][key][field] = next;
      writeStore(store);
      renderPreviews();
    }
  });
  label.append(span, input);
  return label;
}

function renderAll() {
  renderPreviews();
  renderSummary();
  renderDailyList();
  renderHistory();
}

function setMode(mode) {
  const strength = mode === "strength";
  elements.strengthForm.classList.toggle("hidden", !strength);
  elements.cardioForm.classList.toggle("hidden", strength);
  $$(".mode-button").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  renderPreviews();
}

function saveStrength() {
  const store = readStore();
  const estimate = strengthEstimate();
  if (!estimate.sets.length) {
    setStatus("セットの重量と回数を入力してください。", "error");
    return;
  }

  const date = selectedDate();
  const weight = numberFromInput(elements.bodyWeight);
  if (weight) store.weights[date] = weight;
  store.workouts.push({
    id: uuid(),
    date,
    mode: "strength",
    key: elements.strengthName.value,
    name: estimate.rate.label,
    sets: estimate.sets,
    reps: estimate.reps,
    minutes: estimate.minutes,
    volume: estimate.volume,
    calories: estimate.calories,
    baseRate: clone(estimate.baseRate),
    effectiveRate: clone(estimate.rate),
    referenceWeightKg,
    bodyWeight: weight || activeBodyWeight(),
    createdAt: new Date().toISOString(),
  });
  writeStore(store);
  setStatus(`${estimate.rate.label} を保存しました。`);
  elements.setList.textContent = "";
  elements.strengthDuration.value = "";
  addSetRow();
  addSetRow();
  addSetRow();
  renderAll();
}

function saveCardio() {
  const store = readStore();
  const estimate = cardioEstimate();
  if (!estimate.minutes) {
    setStatus("分数を入力してください。", "error");
    return;
  }

  const date = selectedDate();
  const weight = numberFromInput(elements.bodyWeight);
  if (weight) store.weights[date] = weight;
  store.workouts.push({
    id: uuid(),
    date,
    mode: "cardio",
    key: elements.cardioName.value,
    name: estimate.rate.label,
    minutes: estimate.minutes,
    calories: estimate.calories,
    baseRate: clone(estimate.baseRate),
    effectiveRate: clone(estimate.rate),
    referenceWeightKg,
    bodyWeight: weight || activeBodyWeight(),
    createdAt: new Date().toISOString(),
  });
  writeStore(store);
  setStatus(`${estimate.rate.label} を保存しました。`);
  elements.cardioMinutes.value = "";
  renderAll();
}

function loadWeightForDate() {
  const latest = latestWeightOn(selectedDate());
  elements.bodyWeight.value = latest?.value ? latest.value.toFixed(1) : "";
  renderAll();
}

function saveWeight() {
  const weight = numberFromInput(elements.bodyWeight);
  if (!weight) {
    setStatus("体重を入力してください。", "error");
    return;
  }
  const store = readStore();
  store.weights[selectedDate()] = weight;
  writeStore(store);
  setStatus("体重メモを保存しました。");
  renderAll();
}

function copyLastStrengthSet() {
  const store = readStore();
  const key = elements.strengthName.value;
  const last = store.workouts
    .filter((workout) => workout.mode === "strength" && workout.key === key)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
  if (!last) {
    setStatus("コピーできる前回セットがありません。");
    return;
  }
  elements.setList.textContent = "";
  last.sets.forEach((set) => addSetRow(set.weight, set.reps));
  elements.strengthDuration.value = last.minutes;
  setStatus(`${last.name} の前回セットをコピーしました。`);
}

function seedSamples() {
  const today = localDate();
  const store = readStore();
  const samples = [
    {
      date: addDays(today, -6),
      mode: "strength",
      key: "latPulldown",
      sets: [
        { weight: 35, reps: 12 },
        { weight: 40, reps: 10 },
        { weight: 40, reps: 10 },
      ],
    },
    { date: addDays(today, -5), mode: "cardio", key: "walking", minutes: 35 },
    {
      date: addDays(today, -3),
      mode: "strength",
      key: "chestPress",
      sets: [
        { weight: 35, reps: 12 },
        { weight: 40, reps: 10 },
        { weight: 40, reps: 8 },
      ],
    },
    { date: addDays(today, -2), mode: "cardio", key: "running", minutes: 22 },
    {
      date: today,
      mode: "strength",
      key: "legPress",
      sets: [
        { weight: 80, reps: 12 },
        { weight: 90, reps: 10 },
        { weight: 90, reps: 10 },
      ],
    },
    { date: today, mode: "cardio", key: "step", minutes: 15 },
  ];

  samples.forEach((sample) => {
    if (sample.mode === "cardio") {
      const baseRate = store.rates.cardio[sample.key];
      const rate = { ...baseRate, weightFactor: 1, bodyWeight: referenceWeightKg };
      store.workouts.push({
        id: uuid(),
        ...sample,
        name: rate.label,
        calories: sample.minutes * rate.kcalPerMinute,
        baseRate: clone(baseRate),
        effectiveRate: clone(rate),
        referenceWeightKg,
        bodyWeight: referenceWeightKg,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    const baseRate = store.rates.strength[sample.key];
    const rate = { ...baseRate, weightFactor: 1, bodyWeight: referenceWeightKg };
    const minutes = estimatedStrengthMinutes(sample.sets);
    const reps = totalReps(sample.sets);
    store.workouts.push({
      id: uuid(),
      ...sample,
      name: rate.label,
      reps,
      minutes,
      volume: strengthVolume(sample.sets),
      calories: reps * rate.kcalPerRep + minutes * rate.kcalPerMinute,
      baseRate: clone(baseRate),
      effectiveRate: clone(rate),
      referenceWeightKg,
      bodyWeight: referenceWeightKg,
      createdAt: new Date().toISOString(),
    });
  });
  writeStore(store);
  setStatus("サンプルを追加しました。");
  renderAll();
}

function exportJson() {
  const payload = JSON.stringify(readStore(), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `training-log-${localDate()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function resetRates() {
  const store = readStore();
  store.rates = defaultRates();
  writeStore(store);
  populateExerciseOptions();
  renderRateEditor();
  renderAll();
  setStatus("係数を初期値に戻しました。");
}

elements.todayBadge.textContent = formatBadge.format(new Date());
elements.entryDate.value = localDate();
populateExerciseOptions();
addSetRow();
addSetRow();
addSetRow();
loadWeightForDate();
renderRateEditor();

$$(".mode-button").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

elements.signInButton.addEventListener("click", signInWithEmail);
elements.signOutButton.addEventListener("click", signOut);
elements.emailInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    signInWithEmail();
  }
});
elements.entryDate.addEventListener("change", loadWeightForDate);
elements.bodyWeight.addEventListener("input", renderPreviews);
elements.saveWeightButton.addEventListener("click", saveWeight);
elements.strengthName.addEventListener("change", renderPreviews);
elements.strengthDuration.addEventListener("input", renderPreviews);
elements.cardioName.addEventListener("change", renderPreviews);
elements.cardioMinutes.addEventListener("input", renderPreviews);
elements.addSetButton.addEventListener("click", () => addSetRow());
elements.copyLastSetButton.addEventListener("click", copyLastStrengthSet);
elements.resetRatesButton.addEventListener("click", resetRates);
elements.seedButton.addEventListener("click", seedSamples);
elements.exportButton.addEventListener("click", exportJson);

elements.strengthForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveStrength();
});

elements.cardioForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveCardio();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // LAN HTTP on iPhone can block service workers; the app still works online.
    });
  });
}

renderAll();
initAuth();
