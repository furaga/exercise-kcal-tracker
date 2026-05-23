# 利用ログ追加 引き継ぎメモ

作成日: 2026-05-23
対象アプリ: `training-log-prototype`
最新確認コミット: `c52ee17 Refine workout preview and previous copy controls`

## 目的

各ログインユーザーの利用状況を Supabase に残す。

現在のDBを見るだけでも「保存された運動記録・体重・係数」は確認できるが、「アプリを開いた」「前回コピーを押した」「保存に失敗した」などの操作ログは残らない。これらを見たい場合は、DBテーブル追加に加えてアプリ側からイベント送信する実装が必要。

## 現状

- フロント: `web/app.js`
- Supabase schema: `supabase/schema.sql`
- localStorage key: `training-log-v3`
- Supabase URL: `https://lavpmdrjwtsbsxumfnon.supabase.co`
- 既存テーブル:
  - `public.workouts`: 運動記録
  - `public.weights`: 体重メモ
  - `public.exercise_rates`: ユーザー別の消費カロリー係数
- 既存テーブルは RLS で `auth.uid() = user_id` の自分の行だけ操作可能。
- 未ログイン時は localStorage 保存のみ。Supabase には送れない。

## 方針

まずはログイン済みユーザーだけを対象にする。

`public.usage_events` を追加し、アプリ側で `trackEvent(eventName, props)` を呼んで insert する。ログ取得失敗で通常操作が失敗すると困るので、ログ送信は best effort にする。

## 追加SQL案

Supabase SQL Editor で実行する。

```sql
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  event_name text not null,
  event_props jsonb not null default '{}',
  app_version text,
  page_path text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.usage_events enable row level security;

grant insert on public.usage_events to authenticated;

drop policy if exists "usage_events insert own" on public.usage_events;

create policy "usage_events insert own"
on public.usage_events for insert
with check (auth.uid() = user_id);

create index if not exists usage_events_user_created_idx
on public.usage_events (user_id, created_at desc);

create index if not exists usage_events_name_created_idx
on public.usage_events (event_name, created_at desc);
```

メモ:

- アプリ利用者自身にログを読ませないなら `select` grant/policy は不要。
- Supabase Dashboard / SQL Editor から見る管理用途なら、Dashboard は service role 相当なので RLS の制約を受けずに見られる。
- ユーザー別にメールまで見たい集計は `auth.users` と join する。

## アプリ側実装案

`web/app.js` に追加する関数:

```js
function appVersion() {
  const script = document.querySelector('script[src*="app.js"]');
  return script?.src.match(/v=([^&]+)/)?.[1] || "local";
}

async function trackEvent(eventName, props = {}) {
  if (!supabaseClient || !currentUser) return;

  const { error } = await supabaseClient.from("usage_events").insert({
    user_id: currentUser.id,
    event_name: eventName,
    event_props: props,
    app_version: appVersion(),
    page_path: location.pathname + location.search,
    user_agent: navigator.userAgent,
  });

  if (error) {
    console.warn("usage event failed", eventName, error.message);
  }
}

function trackEventSoon(eventName, props = {}) {
  trackEvent(eventName, props).catch((error) => {
    console.warn("usage event failed", eventName, error.message);
  });
}
```

通常の保存処理を待たせないため、各操作箇所では `trackEventSoon(...)` を使う。

## 差し込み候補

`web/app.js` の主な関数:

- `initAuth()` / `loadUserData()`
  - `app_open`
  - `auth_loaded`
  - `sync_success`
  - `sync_error`
- `signInWithGoogle()`
  - `sign_in_start`
- `saveStrength()`
  - `save_workout`
  - props: `{ mode: "strength", date, key, name, reps, volume, calories, editing: Boolean(editingWorkoutId) }`
- `saveCardio()`
  - `save_workout`
  - props: `{ mode: "cardio", date, key, name, minutes, calories, editing: Boolean(editingWorkoutId) }`
- `deleteWorkout(workout)`
  - `delete_workout`
  - props: `{ mode: workout.mode, date: workout.date, key: workout.key, calories: workout.calories }`
- `copyLastStrengthSet()`
  - `copy_previous`
  - props: `{ mode: "strength", key, copied_from_date: last.date }`
- `copyLastCardio()`
  - `copy_previous`
  - props: `{ mode: "cardio", key, copied_from_date: last.date }`
- `saveWeight()`
  - `save_weight`
  - props: `{ date: selectedDate(), weight_kg: weight }`
- `resetRates()`
  - `reset_rates`
- `exportJson()`
  - `export_json`

必要なら `setMode(mode)` で `switch_mode` を取れるが、イベントが多くなりやすいので最初は不要でよい。

## 推奨イベント名

- `app_open`
- `sign_in_start`
- `auth_loaded`
- `sync_success`
- `sync_error`
- `save_workout`
- `delete_workout`
- `copy_previous`
- `save_weight`
- `reset_rates`
- `export_json`

## 集計SQL例

ユーザー別イベント件数:

```sql
select
  u.email,
  e.event_name,
  count(*) as event_count,
  max(e.created_at) as last_seen_at
from public.usage_events e
join auth.users u on u.id = e.user_id
group by u.email, e.event_name
order by last_seen_at desc;
```

日別アクティブユーザー:

```sql
select
  date_trunc('day', created_at) as day,
  count(distinct user_id) as active_users,
  count(*) as events
from public.usage_events
group by day
order by day desc;
```

保存イベントの内訳:

```sql
select
  event_props->>'mode' as mode,
  count(*) as saves,
  avg((event_props->>'calories')::numeric) as avg_calories
from public.usage_events
where event_name = 'save_workout'
group by mode;
```

## 注意点

- `usage_events` は増え続ける。運用が長くなるなら30日/90日で削除する運用、または月次集計テーブルを検討する。
- `event_props` にメールアドレスやトークンなどの個人情報・秘密情報は入れない。
- 未ログインユーザーも追いたい場合は別設計が必要。匿名IDを localStorage に持たせる、または Edge Function 経由で許可するなど。ただしスパム/濫用対策が必要になる。
- `trackEvent` の失敗で保存処理を止めない。
- アプリ側変更後は `index.html` と `sw.js` の `app.js?v=...` を更新する。

## 明日の作業順

1. Supabase SQL Editor で `usage_events` テーブルを追加。
2. `web/app.js` に `appVersion` / `trackEvent` / `trackEventSoon` を追加。
3. 保存・削除・前回コピー・体重保存・ログイン/同期の関数にイベント送信を差し込む。
4. `web/index.html` と `web/sw.js` の asset version を上げる。
5. ローカルで Google ログイン後、数操作して `usage_events` に行が入ることを確認。
6. `node --check web\app.js` と `git diff --check` を実行。
7. commit / push / GitHub Pages deploy を確認。
