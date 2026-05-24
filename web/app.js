const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const storeKey = "training-log-v3";
const supabaseUrl = "https://lavpmdrjwtsbsxumfnon.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhdnBtZHJqd3RzYnN4dW1mbm9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjI0NzcsImV4cCI6MjA5NTA5ODQ3N30.fVSQoXxRRiF_iGJn8gREfCgZPgbM-BMT07dXLzWlibA";
const referenceWeightKg = 57.5;
const weeklyGoalKcal = 2000;
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
let selectedHistoryDate = null;
let editingWorkoutId = null;

const defaultStrengthRates = {
  pushup: { label: "腕立て伏せ", icon: "💪", kcalPerRep: 0.28, kcalPerMinute: 1.8 },
  legPress: { label: "レッグプレス", icon: "🦵", kcalPerRep: 0.45, kcalPerMinute: 1.9 },
  latPulldown: { label: "ラットプルダウン", icon: "⬇", kcalPerRep: 0.32, kcalPerMinute: 1.6 },
  shoulderPress: { label: "ショルダープレス", icon: "🏋", kcalPerRep: 0.3, kcalPerMinute: 1.6 },
  chestPress: { label: "チェストプレス", icon: "↔", kcalPerRep: 0.32, kcalPerMinute: 1.6 },
  bicepsCurl: { label: "バイセップスカール", icon: "💪", kcalPerRep: 0.24, kcalPerMinute: 1.4 },
  dips: { label: "ディップス", icon: "↓", kcalPerRep: 0.3, kcalPerMinute: 1.5 },
  adduction: { label: "アダクション", icon: "→←", kcalPerRep: 0.28, kcalPerMinute: 1.4 },
  abduction: { label: "アブダクション", icon: "←→", kcalPerRep: 0.3, kcalPerMinute: 1.5 },
  abdominalTrainer: { label: "アブドミナルトレーナー", icon: "◎", kcalPerRep: 0.3, kcalPerMinute: 1.5 },
  abBench: { label: "アブベンチ", icon: "▱", kcalPerRep: 0.24, kcalPerMinute: 1.4 },
};

const defaultCardioRates = {
  step: { label: "踏み台昇降", icon: "▰", kcalPerMinute: 5.0 },
  walking: { label: "ウォーキング", icon: "🚶", kcalPerMinute: 3.4 },
  bike: { label: "エアロバイク（バイク）", icon: "🚲", kcalPerMinute: 4.8 },
  running: { label: "ランニング", icon: "🏃", kcalPerMinute: 7.2 },
};

const bodyweightStrengthKeys = new Set(["abBench", "pushup"]);
const deprecatedRateKeys = {
  cardio: new Set(["deskBike", "treadmill"]),
  strength: new Set(),
};
const cardioDistanceConfig = {
  walking: { referenceKmh: 4.8, minKmh: 1, maxKmh: 8 },
  running: { referenceKmh: 8, minKmh: 5, maxKmh: 22 },
};

const elements = {
  todayBadge: $("#todayBadge"),
  allCalories: $("#allCalories"),
  weekCalories: $("#weekCalories"),
  weekProgress: $("#weekProgress"),
  weekChart: $("#weekChart"),
  authStatus: $("#authStatus"),
  authIdentity: $("#authIdentity"),
  googleSignInButton: $("#googleSignInButton"),
  signOutButton: $("#signOutButton"),
  todayCalories: $("#todayCalories"),
  monthCalories: $("#monthCalories"),
  loggedDays: $("#loggedDays"),
  entryDate: $("#entryDate"),
  bodyWeight: $("#bodyWeight"),
  saveWeightButton: $("#saveWeightButton"),
  weightStatus: $("#weightStatus"),
  strengthForm: $("#strengthForm"),
  cardioForm: $("#cardioForm"),
  strengthName: $("#strengthName"),
  strengthExtraDetails: $("#strengthExtraDetails"),
  strengthDurationSummary: $("#strengthDurationSummary"),
  strengthDuration: $("#strengthDuration"),
  clearStrengthDurationButton: $("#clearStrengthDurationButton"),
  strengthRateNote: $("#strengthRateNote"),
  setList: $("#setList"),
  addSetButton: $("#addSetButton"),
  copyLastCardioButton: $("#copyLastCardioButton"),
  copyLastStrengthButton: $("#copyLastStrengthButton"),
  strengthReps: $("#strengthReps"),
  strengthMinutes: $("#strengthMinutes"),
  strengthCalories: $("#strengthCalories"),
  strengthSaveCalories: $("#strengthSaveCalories"),
  cardioName: $("#cardioName"),
  cardioMinutes: $("#cardioMinutes"),
  cardioExtraDetails: $("#cardioExtraDetails"),
  cardioExtraSummary: $("#cardioExtraSummary"),
  cardioDistance: $("#cardioDistance"),
  cardioManualCalories: $("#cardioManualCalories"),
  clearCardioExtraButton: $("#clearCardioExtraButton"),
  cardioMinus: $("#cardioMinus"),
  cardioPlus: $("#cardioPlus"),
  cardioRateNote: $("#cardioRateNote"),
  cardioRate: $("#cardioRate"),
  cardioPreviewMinutes: $("#cardioPreviewMinutes"),
  cardioCalories: $("#cardioCalories"),
  cardioSaveCalories: $("#cardioSaveCalories"),
  cardioSubmitButton: $("#cardioForm .primary-button"),
  statusText: $("#statusText"),
  rateEditor: $("#rateEditor"),
  resetRatesButton: $("#resetRatesButton"),
  comparisonList: $("#comparisonList"),
  historyTabs: $("#historyTabs"),
  historyList: $("#historyList"),
  strengthSubmitButton: $("#strengthForm .primary-button"),
  exportButton: $("#exportButton"),
};

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
const weekChartLabels = ["月", "火", "水", "木", "金", "土", "日"];
const numberFormat = new Intl.NumberFormat("ja-JP");

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

function exerciseDisplayName(rate) {
  return rate.icon ? `${rate.icon} ${rate.label}` : rate.label;
}

function mergeRateGroup(defaultGroup, savedGroup = {}, removedKeys = new Set()) {
  const merged = {};
  Object.entries(defaultGroup).forEach(([key, defaultRate]) => {
    const savedRate = savedGroup[key] || {};
    merged[key] = {
      ...defaultRate,
      ...savedRate,
      label: defaultRate.label,
    };
  });

  Object.entries(savedGroup || {}).forEach(([key, rate]) => {
    if (removedKeys.has(key)) return;
    if (!merged[key]) merged[key] = rate;
  });

  return merged;
}

function normalizeStore(parsed = {}) {
  return {
    weights: parsed.weights || {},
    workouts: Array.isArray(parsed.workouts) ? parsed.workouts : [],
    rates: {
      strength: mergeRateGroup(defaultStrengthRates, parsed.rates?.strength, deprecatedRateKeys.strength),
      cardio: mergeRateGroup(defaultCardioRates, parsed.rates?.cardio, deprecatedRateKeys.cardio),
    },
  };
}

function emptyStore() {
  return normalizeStore();
}

function readStore() {
  try {
    return normalizeStore(JSON.parse(localStorage.getItem(storeKey) || "{}"));
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  localStorage.setItem(storeKey, JSON.stringify(normalizeStore(store)));
  scheduleCloudSync();
}

function writeLocalStore(store) {
  localStorage.setItem(storeKey, JSON.stringify(normalizeStore(store)));
}

function formatNumber(value) {
  return numberFormat.format(Math.round(value || 0));
}

function formatBadgeDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}(${weekdayLabels[date.getDay()]})`;
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
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

function selectedDate() {
  return elements.entryDate.value || localDate();
}

function numberFromInput(input) {
  const value = Number(input.value);
  return Number.isFinite(value) && input.value !== "" ? value : null;
}

function roundKcal(value) {
  return Math.round(value || 0);
}

function fixed(value, digits = 2) {
  const text = Number(value || 0).toFixed(digits);
  return text.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function setStatus(message, tone = "normal") {
  elements.statusText.textContent = message;
  elements.statusText.dataset.tone = tone;
}

function setWeightStatus(message, tone = "normal") {
  if (!elements.weightStatus) return;
  elements.weightStatus.textContent = message;
  elements.weightStatus.dataset.tone = tone;
}

function setAuthStatus(message) {
  if (elements.authStatus) {
    elements.authStatus.textContent = message;
  }
}

function scheduleCloudSync() {
  if (!currentUser || !cloudReady || suppressCloudSync) return;
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => {
    syncCloud().catch((error) => {
      setAuthStatus(`クラウド同期に失敗しました: ${error.message}`);
    });
  }, 500);
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

function updateAuthUi() {
  const signedIn = Boolean(currentUser);
  const identity = currentUser?.email || currentUser?.user_metadata?.full_name || "ログイン中";
  elements.googleSignInButton?.classList.toggle("hidden", signedIn);
  elements.signOutButton?.classList.toggle("hidden", !signedIn);
  elements.authIdentity?.classList.toggle("hidden", !signedIn);
  if (elements.authIdentity) {
    elements.authIdentity.textContent = signedIn ? identity : "";
    elements.authIdentity.title = signedIn ? `ログイン中: ${identity}` : "";
  }
  if (elements.googleSignInButton) {
    elements.googleSignInButton.disabled = false;
    elements.googleSignInButton.textContent = "ログイン";
  }
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
  signInWithGoogle();
}

async function signInWithGoogle() {
  if (!supabaseClient) {
    setAuthStatus("Supabaseライブラリを読み込めませんでした。");
    return;
  }

  elements.googleSignInButton.disabled = true;
  elements.googleSignInButton.textContent = "接続中";
  setAuthStatus("Googleログインへ移動しています...");
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl(),
      queryParams: {
        prompt: "select_account",
      },
    },
  });
  if (error) {
    elements.googleSignInButton.disabled = false;
    elements.googleSignInButton.textContent = "ログイン";
    setAuthStatus(`Googleログインに失敗しました: ${error.message}`);
  }
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
    const nextId = uuid();
    if (editingWorkoutId === workout.id) {
      editingWorkoutId = nextId;
    }
    return { ...workout, id: nextId };
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
  const effectiveRate = row.effective_rate || row.base_rate || {};
  const distanceKm = row.distance_km ?? effectiveRate.distanceKm ?? null;
  const manualCalories = row.manual_calories ?? effectiveRate.manualCalories ?? null;
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
    effectiveRate,
    distanceKm: distanceKm === null ? null : Number(distanceKm),
    manualCalories: manualCalories === null ? null : Number(manualCalories),
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
  return normalizeStore({ rates }).rates;
}

async function deleteMissingRows(table, keyColumn, localKeys) {
  const { data, error } = await supabaseClient
    .from(table)
    .select(keyColumn)
    .eq("user_id", currentUser.id);
  if (error) throw error;

  const local = new Set(localKeys);
  for (const row of data || []) {
    const value = row[keyColumn];
    if (!local.has(value)) {
      const { error: deleteError } = await supabaseClient
        .from(table)
        .delete()
        .eq("user_id", currentUser.id)
        .eq(keyColumn, value);
      if (deleteError) throw deleteError;
    }
  }
}

async function syncCloud() {
  if (!supabaseClient || !currentUser || !cloudReady) return;
  const store = normalizeStoreForCloud(readStore());
  setAuthStatus("Supabaseに同期中...");

  await deleteMissingRows(
    "workouts",
    "id",
    store.workouts.map((workout) => workout.id),
  );
  if (store.workouts.length) {
    const { error } = await supabaseClient
      .from("workouts")
      .upsert(store.workouts.map(workoutToRow), { onConflict: "id" });
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

  return normalizeStore({
    weights: { ...local.weights, ...remoteWeights },
    workouts: [
      ...remoteWorkouts,
      ...local.workouts.filter((workout) => !remoteWorkoutIds.has(workout.id)),
    ],
    rates: {
      strength: { ...local.rates.strength, ...remoteRates.strength },
      cardio: { ...local.rates.cardio, ...remoteRates.cardio },
    },
  });
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
    setAuthStatus(`Supabaseの読み込みに失敗しました: ${error.message}`);
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
  if (Math.abs(weight - referenceWeightKg) < 0.05) return `基準 ${referenceWeightKg}kg`;
  return `${fixed(weight, 1)}kg補正 x${fixed(weight / referenceWeightKg, 2)}`;
}

function populateExerciseOptions() {
  const store = readStore();
  elements.strengthName.textContent = "";
  Object.entries(store.rates.strength).forEach(([key, rate]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = exerciseDisplayName(rate);
    elements.strengthName.append(option);
  });

  elements.cardioName.textContent = "";
  Object.entries(store.rates.cardio).forEach(([key, rate]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = exerciseDisplayName(rate);
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

function strengthUsesLoad(key = elements.strengthName.value) {
  return !bodyweightStrengthKeys.has(key);
}

function firstRate(group) {
  return Object.values(group)[0] || { label: "未設定", kcalPerRep: 0, kcalPerMinute: 0 };
}

function strengthEstimate() {
  const store = readStore();
  const sets = parseSets();
  const baseRate = store.rates.strength[elements.strengthName.value] || firstRate(store.rates.strength);
  const rate = adjustedRate(baseRate);
  const usesLoad = strengthUsesLoad();
  const manualMinutes = numberFromInput(elements.strengthDuration);
  const minutes = manualMinutes || estimatedStrengthMinutes(sets);
  const reps = totalReps(sets);
  const calories = reps * (rate.kcalPerRep || 0) + minutes * (rate.kcalPerMinute || 0);
  return {
    sets,
    baseRate,
    rate,
    usesLoad,
    minutes,
    reps,
    calories,
    volume: usesLoad ? strengthVolume(sets) : 0,
  };
}

function cardioDistanceFactor(key, minutes, distanceKm) {
  const config = cardioDistanceConfig[key];
  if (!config || !minutes || !distanceKm) return { averageKmh: null, factor: 1 };
  const averageKmh = distanceKm / (minutes / 60);
  const boundedKmh = Math.max(config.minKmh, Math.min(config.maxKmh, averageKmh));
  return {
    averageKmh,
    factor: boundedKmh / config.referenceKmh,
  };
}

function cardioEstimate() {
  const store = readStore();
  const key = elements.cardioName.value;
  const baseRate = store.rates.cardio[key] || firstRate(store.rates.cardio);
  const baseAdjustedRate = adjustedRate(baseRate);
  const minutes = numberFromInput(elements.cardioMinutes) || 0;
  const distanceKm = numberFromInput(elements.cardioDistance);
  const manualCalories = numberFromInput(elements.cardioManualCalories);
  const distance = cardioDistanceFactor(key, minutes, distanceKm);
  const rate = {
    ...baseAdjustedRate,
    kcalPerMinute: baseAdjustedRate.kcalPerMinute * distance.factor,
    distanceKm,
    averageKmh: distance.averageKmh,
    distanceFactor: distance.factor,
    manualCalories,
    manualOverride: manualCalories !== null,
  };
  const calculatedCalories = minutes * (rate.kcalPerMinute || 0);
  const calories = manualCalories !== null ? manualCalories : calculatedCalories;
  return { baseRate, rate, minutes, distanceKm, manualCalories, calories, calculatedCalories };
}

function formattedStepperValue(value, step) {
  return fixed(value, step < 1 ? 1 : 0);
}

function bindSelectAllOnFocus(input) {
  input.addEventListener("focus", () => {
    input.dataset.selectingOnFocus = "true";
    input.select();
  });
  input.addEventListener("mouseup", (event) => {
    if (input.dataset.selectingOnFocus === "true") {
      event.preventDefault();
      delete input.dataset.selectingOnFocus;
    }
  });
  input.addEventListener("keydown", () => {
    delete input.dataset.selectingOnFocus;
  });
  input.addEventListener("blur", () => {
    delete input.dataset.selectingOnFocus;
  });
}

function adjustSetInput(input, delta) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 1000);
  const step = Number(input.step || 1);
  const current = Number(input.value || 0);
  const next = Math.max(min, Math.min(max, current + delta));
  input.value = formattedStepperValue(next, step);
  renderPreviews();
}

function createSetStepper({ field, value, unit, min, max, step, inputMode, label }) {
  const wrapper = document.createElement("div");
  wrapper.className = "set-stepper";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.textContent = "−";
  minus.setAttribute("aria-label", `${label}を減らす`);

  const valueWrap = document.createElement("span");
  valueWrap.className = "stepper-value";

  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.inputMode = inputMode;
  input.dataset.field = field;
  input.value = value === "" ? "" : formattedStepperValue(Number(value), step);
  input.setAttribute("aria-label", label);
  bindSelectAllOnFocus(input);

  const suffix = document.createElement("span");
  suffix.textContent = unit;
  valueWrap.append(input, suffix);

  const plus = document.createElement("button");
  plus.type = "button";
  plus.textContent = "+";
  plus.setAttribute("aria-label", `${label}を増やす`);

  minus.addEventListener("click", () => adjustSetInput(input, -step));
  plus.addEventListener("click", () => adjustSetInput(input, step));
  input.addEventListener("input", renderPreviews);

  wrapper.append(minus, valueWrap, plus);
  return wrapper;
}

function addSetRow(weight = "", reps = "") {
  const usesLoad = strengthUsesLoad();
  const row = document.createElement("div");
  row.className = "set-row";
  if (!usesLoad) row.classList.add("bodyweight-set");

  const number = document.createElement("div");
  number.className = "set-number";

  const weightControl = usesLoad
    ? createSetStepper({
        field: "weight",
        value: weight === "" ? 60 : weight,
        unit: "kg",
        min: 0,
        max: 1000,
        step: 5,
        inputMode: "decimal",
        label: "重量",
      })
    : null;

  const hiddenWeight = document.createElement("input");
  hiddenWeight.type = "number";
  hiddenWeight.dataset.field = "weight";
  hiddenWeight.value = "0";
  hiddenWeight.className = "hidden-field";

  const repsControl = createSetStepper({
    field: "reps",
    value: reps === "" ? 10 : reps,
    unit: "回",
    min: 1,
    max: 500,
    step: 1,
    inputMode: "numeric",
    label: "回数",
  });

  const remove = document.createElement("button");
  remove.className = "remove-set-button";
  remove.type = "button";
  remove.title = "セット削除";
  remove.textContent = "−";
  remove.addEventListener("click", () => {
    row.remove();
    renumberSets();
    renderPreviews();
  });

  row.append(number);
  if (weightControl) {
    row.append(weightControl);
  } else {
    row.append(hiddenWeight);
  }
  row.append(repsControl, remove);
  elements.setList.append(row);
  renumberSets();
  renderPreviews();
}

function rerenderSetRowsForExercise() {
  const nextUsesLoad = strengthUsesLoad();
  const sets = $$(".set-row").map((row) => ({
    weight: row.querySelector('[data-field="weight"]')?.value || "",
    reps: row.querySelector('[data-field="reps"]')?.value || "",
  }));
  elements.setList.textContent = "";
  (sets.length ? sets : [{ weight: "", reps: "" }]).forEach((set) => {
    const weight = nextUsesLoad && Number(set.weight) <= 0 ? "" : set.weight;
    addSetRow(weight, set.reps);
  });
}

function renumberSets() {
  $$(".set-row").forEach((row, index) => {
    row.querySelector(".set-number").textContent = String(index + 1);
  });
}

function updateMinuteChips(minutes) {
  $$("[data-cardio-minutes]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.cardioMinutes) === minutes);
  });
}

function updateStrengthDurationSummary() {
  const minutes = numberFromInput(elements.strengthDuration);
  elements.strengthDurationSummary.textContent = minutes ? `${fixed(minutes, 1)}分` : "自動";
  elements.strengthExtraDetails.classList.toggle("has-values", Boolean(minutes));
}

function updateCardioExtraSummary(cardio) {
  const parts = [];
  if (cardio.distanceKm) parts.push(`${fixed(cardio.distanceKm, 2)}km`);
  if (cardio.manualCalories !== null) parts.push(`${formatNumber(cardio.manualCalories)}kcal`);
  elements.cardioExtraSummary.textContent = parts.length ? parts.join(" / ") : "任意";
  elements.cardioExtraDetails.classList.toggle("has-values", parts.length > 0);
}

function renderPreviews() {
  const strength = strengthEstimate();
  elements.strengthRateNote.textContent =
    `${strength.rate.label}: 基準 ${fixed(strength.baseRate.kcalPerRep)} kcal/回 + ` +
    `${fixed(strength.baseRate.kcalPerMinute)} kcal/分 → ` +
    `${fixed(strength.rate.kcalPerRep)} kcal/回 + ${fixed(strength.rate.kcalPerMinute)} kcal/分 (${weightNote()})`;
  const strengthPreview = elements.strengthReps.closest(".preview-strip");
  const volumeTile = elements.strengthMinutes.closest("div");
  strengthPreview?.classList.toggle("bodyweight-preview", !strength.usesLoad);
  volumeTile?.classList.toggle("hidden", !strength.usesLoad);
  elements.strengthReps.textContent = `${formatNumber(strength.reps)}回`;
  elements.strengthMinutes.textContent = `${formatNumber(strength.volume)}kg`;
  elements.strengthMinutes.nextElementSibling.textContent = "ボリューム";
  elements.strengthCalories.textContent = `${formatNumber(strength.calories)}kcal`;
  elements.strengthCalories.nextElementSibling.textContent = "消費";
  elements.strengthSaveCalories.textContent = `${formatNumber(strength.calories)} kcal`;
  updateStrengthDurationSummary();

  const cardio = cardioEstimate();
  const distanceNote = cardio.distanceKm
    ? `、距離 ${fixed(cardio.distanceKm, 2)}km` +
      (cardio.rate.averageKmh ? `・平均 ${fixed(cardio.rate.averageKmh, 1)}km/h補正 x${fixed(cardio.rate.distanceFactor, 2)}` : "")
    : "";
  const manualNote = cardio.manualCalories !== null ? `、表示kcalを優先（計算値 ${formatNumber(cardio.calculatedCalories)} kcal）` : "";
  elements.cardioRateNote.textContent =
    `${cardio.rate.label}: 基準 ${fixed(cardio.baseRate.kcalPerMinute)} kcal/分 → ` +
    `${fixed(cardio.rate.kcalPerMinute)} kcal/分 (${weightNote()}${distanceNote}${manualNote})`;
  elements.cardioRate.textContent = fixed(cardio.rate.kcalPerMinute);
  elements.cardioPreviewMinutes.textContent = formatNumber(cardio.minutes);
  elements.cardioCalories.textContent = formatNumber(cardio.calories);
  elements.cardioSaveCalories.textContent = `${formatNumber(cardio.calories)} kcal`;
  renderSaveButtonLabels();
  updateMinuteChips(cardio.minutes);
  updateCardioExtraSummary(cardio);
}

function renderSaveButtonLabels() {
  const label = editingWorkoutId ? "更新" : "保存";
  [
    [elements.cardioSubmitButton, elements.cardioSaveCalories],
    [elements.strengthSubmitButton, elements.strengthSaveCalories],
  ].forEach(([button, calories]) => {
    if (!button || !calories) return;
    button.textContent = "";
    button.append(document.createTextNode(`${label} `), calories);
  });
}

function workoutsBetween(startKey, endKey, store = readStore()) {
  return store.workouts.filter((workout) => workout.date >= startKey && workout.date <= endKey);
}

function workoutsOn(dateKey, store = readStore()) {
  return store.workouts.filter((workout) => workout.date === dateKey);
}

function sumCalories(workouts) {
  return workouts.reduce((sum, workout) => sum + (workout.calories || 0), 0);
}

function loggedDateSet(store = readStore()) {
  return new Set(store.workouts.map((workout) => workout.date));
}

function currentStreak(store = readStore()) {
  const dates = loggedDateSet(store);
  if (!dates.size) return 0;
  let cursor = dates.has(localDate()) ? localDate() : Array.from(dates).sort().reverse()[0];
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function renderWeekChart(store, weekStart) {
  if (!elements.weekChart) return;
  const today = localDate();
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const values = dates.map((date) => sumCalories(workoutsOn(date, store)));
  const previousValues = dates.map((date) => sumCalories(workoutsOn(addDays(date, -7), store)));
  const maxValue = Math.max(1, ...values, ...previousValues);

  elements.weekChart.textContent = "";
  dates.forEach((date, index) => {
    const value = values[index];
    const previous = previousValues[index];
    const day = document.createElement("div");
    day.className = "week-day";
    if (date === today) day.classList.add("today");

    const plot = document.createElement("div");
    plot.className = "week-plot";

    const marker = document.createElement("span");
    marker.className = "previous-marker";
    marker.style.setProperty("--marker", `${Math.max(6, (previous / maxValue) * 88)}%`);

    const bar = document.createElement("span");
    bar.className = "week-bar";
    if (!value) bar.classList.add("is-empty");
    bar.style.setProperty("--bar", `${value ? Math.max(8, (value / maxValue) * 100) : 7}%`);

    const label = document.createElement("span");
    label.className = "week-label";
    label.textContent = weekChartLabels[index];

    plot.append(marker, bar);
    day.append(plot, label);
    elements.weekChart.append(day);
  });
}

function renderSummary() {
  const today = localDate();
  const store = readStore();
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);
  const todayWorkouts = workoutsBetween(today, today, store);
  const weekWorkouts = workoutsBetween(weekStart, today, store);
  const monthWorkouts = workoutsBetween(monthStart, today, store);
  const weekCalories = sumCalories(weekWorkouts);

  elements.allCalories.textContent = formatNumber(sumCalories(store.workouts));
  elements.todayCalories.textContent = formatNumber(sumCalories(todayWorkouts));
  elements.weekCalories.textContent = formatNumber(weekCalories);
  elements.monthCalories.textContent = formatNumber(sumCalories(monthWorkouts));
  elements.loggedDays.textContent = formatNumber(currentStreak(store));
  elements.weekProgress.textContent = `${Math.round((weekCalories / weeklyGoalKcal) * 100)}%`;
  renderWeekChart(store, weekStart);
}

function workoutMeasure(workout) {
  if (workout.mode === "strength") {
    return {
      value: Number(workout.volume || strengthVolume(workout.sets || []) || 0),
      unit: "kg",
      label: "負荷量",
    };
  }
  return {
    value: Number(workout.minutes || 0),
    unit: "分",
    label: "時間",
  };
}

function aggregateExercise(workouts) {
  const map = new Map();
  workouts.forEach((workout) => {
    const key = `${workout.mode}:${workout.key}`;
    const measure = workoutMeasure(workout);
    const item = map.get(key) || {
      key,
      mode: workout.mode,
      name: workout.name,
      unit: measure.unit,
      value: 0,
      calories: 0,
    };
    item.value += measure.value;
    item.calories += workout.calories || 0;
    map.set(key, item);
  });
  return map;
}

function signedValue(value, unit) {
  if (!value) return `± 0${unit}`;
  const sign = value > 0 ? "▲" : "▼";
  return `${sign} ${formatNumber(Math.abs(value))}${unit}`;
}

function renderComparisonList() {
  const store = readStore();
  const today = localDate();
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const previousStart = addDays(weekStart, -7);
  const previousEnd = addDays(weekStart, -1);
  const current = aggregateExercise(workoutsBetween(weekStart, weekEnd, store));
  const previous = aggregateExercise(workoutsBetween(previousStart, previousEnd, store));
  const keys = Array.from(new Set([...current.keys(), ...previous.keys()]));

  elements.comparisonList.textContent = "";
  if (!keys.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "今週または先週の記録があると、種目ごとの差分がここに表示されます。";
    elements.comparisonList.append(empty);
    return;
  }

  const items = keys
    .map((key) => {
      const now = current.get(key);
      const before = previous.get(key);
      const unit = now?.unit || before?.unit || "";
      const currentValue = now?.value || 0;
      const previousValue = before?.value || 0;
      const change = currentValue - previousValue;
      const percent = previousValue ? Math.round((change / previousValue) * 100) : currentValue ? 100 : 0;
      return {
        key,
        mode: now?.mode || before?.mode,
        name: now?.name || before?.name,
        unit,
        currentValue,
        previousValue,
        change,
        percent,
      };
    })
    .sort((a, b) => b.currentValue + b.previousValue - (a.currentValue + a.previousValue))
    .slice(0, 4);

  const maxValue = Math.max(1, ...items.flatMap((item) => [item.currentValue, item.previousValue]));
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "comparison-item";

    const head = document.createElement("div");
    head.className = "comparison-head";
    const icon = document.createElement("span");
    icon.className = `exercise-icon ${item.mode === "strength" ? "strength" : "cardio"}`;
    icon.textContent = item.mode === "strength" ? "↔" : "⌁";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const delta = document.createElement("span");
    delta.className = item.change < 0 ? "comparison-delta down" : "comparison-delta";
    delta.textContent = signedValue(item.change, item.unit);
    head.append(icon, name, delta);

    const bars = document.createElement("div");
    bars.className = "comparison-bars";
    const currentBar = document.createElement("span");
    currentBar.className = "bar-fill";
    currentBar.style.setProperty("--bar", `${Math.max(4, (item.currentValue / maxValue) * 100)}%`);
    const previousBar = document.createElement("span");
    previousBar.className = "bar-fill previous";
    previousBar.style.setProperty("--bar", `${Math.max(4, (item.previousValue / maxValue) * 100)}%`);
    bars.append(currentBar, previousBar);

    const foot = document.createElement("div");
    foot.className = "comparison-foot";
    const percent = item.previousValue ? `${item.percent > 0 ? "+" : ""}${item.percent}%` : "new";
    foot.textContent = `${formatNumber(item.currentValue)}${item.unit} / ${formatNumber(item.previousValue)}${item.unit} ・ ${percent}`;

    card.append(head, bars, foot);
    elements.comparisonList.append(card);
  });
}

function workoutDetail(workout) {
  if (workout.mode === "cardio") {
    const distance = workout.distanceKm ? `・${fixed(workout.distanceKm, 2)}km` : "";
    const manual = workout.manualCalories !== null && workout.manualCalories !== undefined ? "・表示kcal" : "";
    return `${workout.minutes}分${distance}${manual}`;
  }
  const sets = (workout.sets || []).map((set) => `${set.weight}kg x ${set.reps}`).join(" / ");
  return `${sets || formatNumber(workout.reps)} / ${fixed(workout.minutes, 1)}分`;
}

function groupedWorkoutsByDate(store = readStore()) {
  const byDate = new Map();
  store.workouts.forEach((workout) => {
    const group = byDate.get(workout.date) || [];
    group.push(workout);
    byDate.set(workout.date, group);
  });
  return byDate;
}

function renderHistoryTabs(dates, byDate) {
  elements.historyTabs.textContent = "";
  dates.slice(0, 14).forEach((date) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-tab";
    button.classList.toggle("active", date === selectedHistoryDate);
    const dateObj = dateFromKey(date);
    const day = document.createElement("small");
    day.textContent = date === localDate() ? "今日" : weekdayLabels[dateObj.getDay()];
    const main = document.createElement("strong");
    main.textContent = formatShortDate(dateObj);
    const kcal = document.createElement("span");
    const calories = sumCalories(byDate.get(date) || []);
    kcal.textContent = calories ? `${formatNumber(calories)} kcal` : "休";
    button.append(day, main, kcal);
    button.addEventListener("click", () => {
      selectedHistoryDate = date;
      elements.entryDate.value = date;
      loadWeightForDate();
    });
    elements.historyTabs.append(button);
  });
}

function loadWorkoutForEdit(workout) {
  editingWorkoutId = workout.id;
  selectedHistoryDate = workout.date;
  elements.entryDate.value = workout.date;
  const workoutWeight = workout.bodyWeight || latestWeightOn(workout.date)?.value;
  elements.bodyWeight.value = workoutWeight ? fixed(workoutWeight, 1) : "";

  if (workout.mode === "cardio") {
    setMode("cardio");
    elements.cardioName.value = workout.key;
    elements.cardioMinutes.value = workout.minutes || "";
    elements.cardioDistance.value = workout.distanceKm || workout.effectiveRate?.distanceKm || "";
    elements.cardioManualCalories.value = workout.manualCalories || workout.effectiveRate?.manualCalories || "";
    elements.cardioExtraDetails.open = Boolean(elements.cardioDistance.value || elements.cardioManualCalories.value);
  } else {
    setMode("strength");
    elements.strengthName.value = workout.key;
    elements.strengthDuration.value = workout.minutes || "";
    elements.strengthExtraDetails.open = Boolean(elements.strengthDuration.value);
    elements.setList.textContent = "";
    (workout.sets || []).forEach((set) => addSetRow(set.weight, set.reps));
    if (!(workout.sets || []).length) addSetRow();
  }

  renderPreviews();
  setStatus(`${workout.name}を編集中です。保存すると履歴を更新します。`);
  document.querySelector(".entry-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteWorkout(workout) {
  const store = readStore();
  store.workouts = store.workouts.filter((item) => item.id !== workout.id);
  if (editingWorkoutId === workout.id) editingWorkoutId = null;
  writeStore(store);
  renderAll();
}

function renderHistory() {
  const store = readStore();
  const byDate = groupedWorkoutsByDate(store);
  const dates = Array.from(byDate.keys()).sort().reverse();

  elements.historyList.textContent = "";
  if (!dates.length) {
    elements.historyTabs.textContent = "";
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "まだ運動履歴はありません。保存すると日付ごとの履歴がここに並びます。";
    elements.historyList.append(empty);
    return;
  }

  if (!selectedHistoryDate || !byDate.has(selectedHistoryDate)) {
    selectedHistoryDate = dates[0];
  }
  renderHistoryTabs(dates, byDate);

  const workouts = (byDate.get(selectedHistoryDate) || []).slice().sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
  const calories = sumCalories(workouts);

  const summary = document.createElement("div");
  summary.className = "history-day-summary";
  const dateLabel = document.createElement("strong");
  dateLabel.textContent = `${formatShortDate(dateFromKey(selectedHistoryDate))}(${weekdayLabels[dateFromKey(selectedHistoryDate).getDay()]})`;
  const count = document.createElement("span");
  count.textContent = `${workouts.length}件・${formatNumber(calories)} kcal`;
  summary.append(dateLabel, count);
  elements.historyList.append(summary);

  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("span");
  fill.className = "bar-fill";
  const maxDayCalories = Math.max(1, ...dates.map((date) => sumCalories(byDate.get(date))));
  fill.style.setProperty("--bar", `${(calories / maxDayCalories) * 100}%`);
  track.append(fill);
  elements.historyList.append(track);

  workouts.forEach((workout) => {
    const item = document.createElement("article");
    item.className = "history-item";

    const icon = document.createElement("span");
    icon.className = `exercise-icon ${workout.mode === "strength" ? "strength" : "cardio"}`;
    icon.textContent = workout.mode === "strength" ? "↔" : "⌁";

    const content = document.createElement("div");
    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = workout.name;

    const detail = document.createElement("p");
    detail.className = "history-detail";
    detail.textContent = workoutDetail(workout);
    content.append(title, detail);

    const kcal = document.createElement("span");
    kcal.className = "history-kcal";
    kcal.textContent = `${formatNumber(workout.calories)} kcal`;

    const edit = document.createElement("button");
    edit.className = "icon-button";
    edit.type = "button";
    edit.title = "編集";
    edit.textContent = "編集";
    edit.addEventListener("click", () => loadWorkoutForEdit(workout));

    const remove = document.createElement("button");
    remove.className = "icon-button danger";
    remove.type = "button";
    remove.title = "削除";
    remove.textContent = "削除";
    remove.addEventListener("click", () => deleteWorkout(workout));

    item.append(icon, content, kcal, edit, remove);
    elements.historyList.append(item);
  });
}

function renderRateEditor() {
  const store = readStore();
  elements.rateEditor.textContent = "";

  const note = document.createElement("p");
  note.className = "rate-help";
  note.textContent = `係数は基準 ${referenceWeightKg}kg の値です。体重メモがある日は入力体重に合わせて自動補正します。`;
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
      name.textContent = exerciseDisplayName(rate);
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
  renderComparisonList();
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
  const wasEditing = Boolean(editingWorkoutId);
  const existingIndex = editingWorkoutId
    ? store.workouts.findIndex((workout) => workout.id === editingWorkoutId)
    : -1;
  const existing = existingIndex >= 0 ? store.workouts[existingIndex] : null;
  const nextWorkout = {
    id: existing?.id || editingWorkoutId || uuid(),
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
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    store.workouts[existingIndex] = nextWorkout;
  } else {
    store.workouts.push(nextWorkout);
  }
  writeStore(store);
  selectedHistoryDate = date;
  setStatus(`${estimate.rate.label}を${wasEditing ? "更新" : "保存"}しました。`);
  editingWorkoutId = null;
  elements.setList.textContent = "";
  elements.strengthDuration.value = "";
  elements.strengthExtraDetails.open = false;
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
  const wasEditing = Boolean(editingWorkoutId);
  const existingIndex = editingWorkoutId
    ? store.workouts.findIndex((workout) => workout.id === editingWorkoutId)
    : -1;
  const existing = existingIndex >= 0 ? store.workouts[existingIndex] : null;
  const nextWorkout = {
    id: existing?.id || editingWorkoutId || uuid(),
    date,
    mode: "cardio",
    key: elements.cardioName.value,
    name: estimate.rate.label,
    minutes: estimate.minutes,
    distanceKm: estimate.distanceKm,
    manualCalories: estimate.manualCalories,
    calories: estimate.calories,
    baseRate: clone(estimate.baseRate),
    effectiveRate: clone(estimate.rate),
    referenceWeightKg,
    bodyWeight: weight || activeBodyWeight(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    store.workouts[existingIndex] = nextWorkout;
  } else {
    store.workouts.push(nextWorkout);
  }
  writeStore(store);
  selectedHistoryDate = date;
  setStatus(`${estimate.rate.label}を${wasEditing ? "更新" : "保存"}しました。`);
  editingWorkoutId = null;
  elements.cardioMinutes.value = "30";
  elements.cardioDistance.value = "";
  elements.cardioManualCalories.value = "";
  elements.cardioExtraDetails.open = false;
  renderAll();
}

function loadWeightForDate() {
  const byDate = groupedWorkoutsByDate();
  if (byDate.has(selectedDate())) {
    selectedHistoryDate = selectedDate();
  }
  const latest = latestWeightOn(selectedDate());
  elements.bodyWeight.value = latest?.value ? latest.value.toFixed(1) : "";
  setWeightStatus("");
  renderAll();
}

function saveWeight() {
  const weight = numberFromInput(elements.bodyWeight);
  if (!weight) {
    setWeightStatus("体重をkgで入力してください。", "error");
    return;
  }
  const store = readStore();
  store.weights[selectedDate()] = weight;
  writeStore(store);
  setWeightStatus("体重メモを保存しました。");
  renderAll();
}

function previousWorkoutFor(mode, key) {
  const date = selectedDate();
  return readStore()
    .workouts.filter(
      (workout) =>
        workout.id !== editingWorkoutId &&
        workout.mode === mode &&
        workout.key === key &&
        workout.date <= date,
    )
    .sort((a, b) => {
      const dateOrder = (b.date || "").localeCompare(a.date || "");
      if (dateOrder) return dateOrder;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    })[0];
}

function copyLastStrengthSet() {
  const key = elements.strengthName.value;
  const last = previousWorkoutFor("strength", key);
  if (!last) {
    setStatus("選択中の日付以前に、同じ筋トレ種目の記録がありません。");
    return;
  }
  elements.setList.textContent = "";
  const copiedSets = Array.isArray(last.sets) ? last.sets : [];
  if (copiedSets.length) {
    copiedSets.forEach((set) => addSetRow(set.weight, set.reps));
  } else {
    addSetRow(strengthUsesLoad(key) ? "" : 0, last.reps || 10);
  }
  elements.strengthDuration.value = last.minutes || "";
  elements.strengthExtraDetails.open = Boolean(elements.strengthDuration.value);
  setStatus(`${last.date}の${last.name}をコピーしました。`);
  renderPreviews();
}

function copyLastCardio() {
  const key = elements.cardioName.value;
  const last = previousWorkoutFor("cardio", key);
  if (!last) {
    setStatus("選択中の日付以前に、同じ有酸素種目の記録がありません。");
    return;
  }
  elements.cardioMinutes.value = last.minutes || "";
  elements.cardioDistance.value = last.distanceKm || last.effectiveRate?.distanceKm || "";
  elements.cardioManualCalories.value = last.manualCalories || last.effectiveRate?.manualCalories || "";
  elements.cardioExtraDetails.open = Boolean(elements.cardioDistance.value || elements.cardioManualCalories.value);
  setStatus(`${last.date}の${last.name}をコピーしました。`);
  renderPreviews();
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

function setCardioMinutes(minutes) {
  elements.cardioMinutes.value = String(Math.max(1, Math.min(600, minutes)));
  renderPreviews();
}

function adjustCardioMinutes(delta) {
  const current = numberFromInput(elements.cardioMinutes) || 0;
  setCardioMinutes(current + delta);
}

function clearCardioExtras() {
  elements.cardioDistance.value = "";
  elements.cardioManualCalories.value = "";
  elements.cardioExtraDetails.open = false;
  renderPreviews();
}

function clearStrengthDuration() {
  elements.strengthDuration.value = "";
  elements.strengthExtraDetails.open = false;
  renderPreviews();
}

function bindEvents() {
  $$(".mode-button").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  elements.googleSignInButton.addEventListener("click", signInWithGoogle);
  elements.signOutButton.addEventListener("click", signOut);
  elements.entryDate.addEventListener("change", loadWeightForDate);
  elements.bodyWeight.addEventListener("input", () => {
    setWeightStatus("");
    renderPreviews();
  });
  elements.saveWeightButton.addEventListener("click", saveWeight);
  elements.strengthName.addEventListener("change", rerenderSetRowsForExercise);
  elements.strengthDuration.addEventListener("input", renderPreviews);
  elements.clearStrengthDurationButton.addEventListener("click", clearStrengthDuration);
  elements.cardioName.addEventListener("change", renderPreviews);
  elements.cardioMinutes.addEventListener("input", renderPreviews);
  elements.cardioDistance.addEventListener("input", renderPreviews);
  elements.cardioManualCalories.addEventListener("input", renderPreviews);
  elements.clearCardioExtraButton.addEventListener("click", clearCardioExtras);
  elements.cardioMinus.addEventListener("click", () => adjustCardioMinutes(-5));
  elements.cardioPlus.addEventListener("click", () => adjustCardioMinutes(5));
  $$("[data-cardio-minutes]").forEach((button) => {
    button.addEventListener("click", () => setCardioMinutes(Number(button.dataset.cardioMinutes)));
  });
  elements.addSetButton.addEventListener("click", () => addSetRow());
  elements.copyLastCardioButton.addEventListener("click", copyLastCardio);
  elements.copyLastStrengthButton.addEventListener("click", copyLastStrengthSet);
  elements.resetRatesButton.addEventListener("click", resetRates);
  elements.exportButton.addEventListener("click", exportJson);

  elements.strengthForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveStrength();
  });

  elements.cardioForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCardio();
  });
}

elements.todayBadge.textContent = formatBadgeDate(new Date());
elements.entryDate.value = localDate();
elements.cardioMinutes.value = "30";
populateExerciseOptions();
addSetRow();
addSetRow();
addSetRow();
renderRateEditor();
loadWeightForDate();
setMode("cardio");
bindEvents();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // LAN HTTP on iPhone can block service workers; the app still works online.
    });
  });
}

initAuth();
