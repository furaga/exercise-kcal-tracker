# training-log-prototype

iPhoneから触れる、ローカルファーストの運動ログPWA試作です。

食事管理は外部アプリに任せ、このプロトタイプでは次を扱います。

- 現在の体重
- 筋トレ種目とセットごとの重量・回数
- 有酸素運動の種目と分数
- 種目ごとの `kcal/回`・`kcal/分` 係数のカスタマイズ
- 係数は基準 57.5kg、体重メモがある日は入力体重に合わせて補正
- これまで、今日、今週、今月の概算消費カロリー
- 日ごとの消費カロリー、実施種目一覧、運動履歴
- Supabaseログイン時のクラウド保存

未ログイン時のデータはブラウザの `localStorage` に保存されます。ログイン時は
Supabaseに同期します。

## Local PWA prototype

```powershell
python serve.py
```

Open the `iPhone:` URL printed by the server on a phone connected to the same
Wi-Fi network.

## Food lookup utility

`food_lookup.py` is kept as a small research CLI for checking public food
nutrition databases, but the PWA no longer uses it for meal tracking.

```powershell
uv run food-lookup search "kitkat" --limit 5
uv run food-lookup barcode 4902777307991
```
