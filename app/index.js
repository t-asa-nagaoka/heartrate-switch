import { me as appbit } from "appbit";
import * as document from "document";
import * as fs from "fs";
import { HeartRateSensor } from "heart-rate";
import { display } from "display";
import { vibration } from "haptics";
import * as messaging from "messaging";

appbit.appTimeoutEnabled = false;

const SETTINGS_FILE = "settings.json";
const RESEND_INTERVAL = 5;
const ALLOW_MISSING_RATE = 0.05;
const RELAX_HIGH = 3;
const RELAX_NORMAL = 2;
const RELAX_LOW = 1;
const RELAX_NONE = 0;
//const MIN_SAMPLES = 2;
const VIBRATION_TIME_MS = 1000;

//const imageRelaxMissingSamples = "blank.png";
const imageRelaxHigh = "high_clear.png";
const imageRelaxNormal = "normal_clear.png";
const imageRelaxLow = "low_clear.png";

//const textRelaxHigh = "リラックス：高";
//const textRelaxNormal = "リラックス：通常";
//const textRelaxLow = "リラックス：低";

//const subjectiveSwitchClasses = "text-button primary application-fill";
//const showDetailsClasses = "text-button secondary application-fill";

const el = {
  currentRelax: document.getElementById("currentRelax"),
  thresholdHigh: document.getElementById("thresholdHigh"),
  thresholdLow: document.getElementById("thresholdLow"),
  retentionPeriod: document.getElementById("retentionPeriod"),
  sendHttp: document.getElementById("sendHttp"),
  preventDetection: document.getElementById("preventDetection"),
  count: document.getElementById("count"),
  tileList: document.getElementById("myList"),
  image: document.getElementById("image"),
  label: document.getElementById("label"),
  subjectiveSwitch: document.getElementById("subjectiveSwitch"),
  showDetails: document.getElementById("showDetails"),
};

const state = {
  settings: null,
  hrm: null,
  hrmTimestamp: null,
  relaxState: RELAX_NONE, // リラックス状態
  distance: null, // LP 原点から重心までの長さ
  area: null, // LP 楕円の面積
  samples: [], // 心拍サンプル(欠損含む)
  activeSamples: [], // 有効な心拍サンプル
  activeSamplesCount: 0, // 有効サンプル数
  retentionCount: 0, // 必要な有効サンプル保持数
  requests: [], // HTTPリクエスト(再送信キュー)
  preventDetection: false, // 検出抑制
  detectionCount: 0, // 検出回数
  subjectiveCount: 0, // 主観スイッチ作動回数
  showImage: true, // アイコン表示
  allowSubjectiveSwitch: true, // 主観スイッチの作動を許可
};

const clock = {
  measure: 0, // 心拍数計測
  calculate: 0, // リラックス傾向の算出・更新
  resend: 0, // HTTPリクエスト再送信
}

setup();

function setup() {
  updateSettings(loadSettings());
  updateDisplay();
  registerHandlers();
}

function registerHandlers() {
  if (HeartRateSensor) {
    state.hrm = new HeartRateSensor({ frequency: 1 });
    state.hrm.start();
    setTimeout(onTimeout, 1000);
  }

  messaging.peerSocket.addEventListener("message", onMessage);

  el.tileList.addEventListener("click", onClickTileList)
  el.showDetails.addEventListener("click", onClickShowDetails);
  el.subjectiveSwitch.addEventListener("click", onClickSubjectiveSwitch);
}

function loadSettings() {
  const defaultSettings = {
    measureInterval: 1,
    calculateInterval: 1,
    retentionPeriod: 600,
    thresholdHigh: 1000,
    thresholdLow: 800,
    sendHttp: false,
    sendUrl: "",
  };

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return fs.readFileSync(SETTINGS_FILE, "json");
    }
  } catch (err) {
    console.error(`loadSettings error: ${err.message}`);
  }

  return defaultSettings;
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, settings, "json");
  } catch (err) {
    console.error(`saveSettings error: ${err.message}`);
  }
}

function updateSettings(settings) {
  state.settings = settings;
}

function onTimeout() {
  resendRequests()

  updateSamples()

  if (activate()) {
    calculateRelax()
    updateRelaxState()
    detectLowRelax()
    updatePreventDetection()
  }

  updateDisplay()
  updateClock()

  setTimeout(onTimeout, 1000);
}

function updateSamples() {
  // 新しい心拍サンプルを追加
  const {heartRate, timestamp} = state.hrm
  const {retentionPeriod, measureInterval} = state.settings

  if (clock.measure == 0 && heartRate && timestamp != state.hrmTimestamp) {
    const duration = 60 * 1000 / heartRate
    state.samples.push(duration)
    state.hrmTimestamp = timestamp
  } else {
    state.samples.push(null)
  }

  // 古い心拍サンプルを削除
  state.samples = state.samples.slice(-retentionPeriod)

  // 必要な有効サンプル保持数を計算
  state.retentionCount = Math.floor(retentionPeriod / measureInterval)

  // 有効なサンプルを抽出
  state.activeSamples = state.samples.filter(sample => sample != null)
  state.activeSamplesCount = state.activeSamples.length
}

function activate() {
  // リラックス傾向の計算が可能かどうか判断する
  // 起動直後からretentionPeriodと同じ秒数が経過するまでは計算不可
  if (clock.calculate == 0 && state.samples.length == state.settings.retentionPeriod && state.activeSamplesCount >= 2) {
    // 心拍サンプルの欠損率を算出する
    // サンプル数が2未満の場合はLP作図不可なため1とする
    const missingRate = 1 - state.activeSamplesCount / state.retentionCount
    return missingRate < ALLOW_MISSING_RATE
  }

  return false
}

function calculateRelax() {
  // ローレンツプロットを生成
  const {activeSamples} = state
  const plots = activeSamples.slice(1).map((current, i) => [activeSamples[i], current])

  // y=x軸 (x'軸), y=-x軸 (y'軸) への変換
  // 座標変換については LP_LOGIC_JAPANESE.pdf を参照
  const rotated = plots.map(plot => {
    const [x, y] = plot
    const xDash = Math.SQRT1_2 * (x + y)
    const yDash = Math.SQRT1_2 * (-x + y)
    return [xDash, yDash]
  })

  // x'軸上, y'軸上における原点からの長さの平均・標準偏差を算出
  const xDash = calculateStats(rotated.map(plot => plot[0]))
  const yDash = calculateStats(rotated.map(plot => plot[1]))

  // ローレンツプロットの原点から重心までの長さ・楕円の面積を算出
  state.distance = xDash.average
  state.area = Math.PI * xDash.stddev * yDash.stddev 
}

function calculateStats(values) {
  const length = values.length
  const sum = values.reduce((memo, value) => memo + value, 0)
  const sum2 = values.reduce((memo, value) => memo + value * value, 0)
  const average = length === 0 ? null : (sum / length)
  const stddev = length === 0 ? null : Math.sqrt(sum2 / length - average * average)

  return {average, stddev}
}

function updateRelaxState() {
  // リラックス状態(低,通常,高)の更新

  //console.log(state.samples[state.samples.length - 1])
  //console.log(state.distance)
  //console.log(state.area)

  if (state.distance == null) {
    state.relaxState = RELAX_NONE
  } else if (state.distance < state.settings.thresholdLow) {
    state.relaxState = RELAX_LOW
  } else if (state.distance > state.settings.thresholdHigh) {
    state.relaxState = RELAX_HIGH
  } else {
    state.relaxState = RELAX_NORMAL
  }
}

function detectLowRelax() {
  // 検出抑制OFF かつ 低リラックス状態
  if (!state.preventDetection && state.relaxState == RELAX_LOW) {
    // 検出回数カウントを 1 増やします。
    state.detectionCount += 1;

    // バイブレーションと画面点灯で知らせます。
    notify();

    // HTTP リクエストを送信する設定になっているかをチェックしています。
    if (state.settings.sendHttp) {
      /** 送信される HTTP リクエストボディの内容を生成します。 */
      const request = createRequest(false);

      /** HTTP リクエストの送信が成功したかどうかです。 */
      const sent = sendRequest(request);

      // HTTP リクエストの送信が失敗したかをチェックしています。
      if (!sent) {
        // 再送信が行われることになるので ON にします。
        request.retry = true;

        // HTTP リクエスト再送信の待ち行列に追加します。
        state.requests.push(request);
      }
    }
  }
}

function notify() {
  if (vibration.start("nudge")) {
    setTimeout(() => vibration.stop(), VIBRATION_TIME_MS);
  }

  display.on = true;
}

function createRequest(subjective) {
  /** HTTPリクエストボディの生成 */
  return {
    /** 送信日時 */
    date: new Date().toISOString(),
    /** 現在のリラックス傾向(距離) ※旧仕様との互換性保持 */
    relax: state.distance ?? 0,
    /** 現在のリラックス傾向(距離) */
    distance: state.distance,
    /** 現在のリラックス傾向(面積) */
    area: state.area,
    /** 心拍サンプルの計測間隔 */
    measureInterval: state.settings.measureInterval,
    /** リラックス傾向の計算・更新間隔 */
    calculateInterval: state.settings.calculateInterval,
    /** 心拍サンプルの所持時間 */
    retentionPeriod: state.settings.retentionPeriod,
    /** 高リラックス状態のしきい値 */
    thresholdHigh: state.settings.thresholdHigh,
    /** 低リラックス状態のしきい値 */
    //threshold: state.settings.thresholdLow,
    thresholdLow: state.settings.thresholdLow,
    /** 主観スイッチであることを示すフラグ */
    subjective,
    /** HTTP リクエストの再送信が行われたかを示すフラグ */
    retry: false,
  };
}

function sendRequest(request) {
  if (messaging.peerSocket.readyState !== messaging.peerSocket.OPEN) {
    return false;
  }

  try {
    const type = "request";
    messaging.peerSocket.send({ type, request });
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function updatePreventDetection() {
  // `state.preventDetection` は低リラックス状態の検出抑制フラグです。
  // このフラグが ON の時は低リラックス状態の検出（+ HTTP リクエスト送信）を行いません。
  //
  // 現在のリラックス傾向が低リラックス状態の閾値付近で上下すると、
  // HTTPリクエストの送信が短時間に何度も行われることになり、
  // それを防ぐためにこのフラグを設けています。
  //
  // 低リラックス状態の検出抑制フラグは下記のように ON/OFF されます。
  // - 現在のリラックス傾向が低リラックス状態のしきい値よりも低い（ストレス状態）→ ON
  // - 現在のリラックス傾向が高リラックス状態のしきい値よりも高い（リラックス状態）→ OFF
  //
  // 詳しくは下記の記事を参照してください。
  // https://zenn.dev/tatsuyasusukida/articles/heart-rate-switch-fitbit-app

  switch (state.relaxState) {
    case RELAX_HIGH:
      state.preventDetection = false
      break
    case RELAX_LOW:
      state.preventDetection = true
      break
  }
}

function onMessage(event) {
  if (event && event.data) {
    const { type } = event.data;

    if (type === "settings") {
      const { settings } = event.data;
      updateSettings(settings);
      saveSettings(settings);
    } else {
      console.warn(`Unknown event.data.type: ${type}`);
    }
  }
}

function resendRequests() {
  if (clock.resend == 0) {
    while (state.requests.length >= 1) {
      const [request] = state.requests;
      const sent = sendRequest(request);
  
      if (!sent) {
        return;
      }
  
      state.requests.shift();
    }
  }
}

function onClickTileList() {
  state.showImage = true;
  updateDisplay();
}

function onClickShowDetails() {
  state.showImage = false;
  updateDisplay();
}

function onClickSubjectiveSwitch() {
  if (state.allowSubjectiveSwitch) {
    // 主観スイッチの回数カウントを 1 増やします。
    state.subjectiveCount += 1;

    // HTTP リクエストを送信する設定になっているかをチェックしています。
    if (state.settings.sendHttp) {
      /** 送信される HTTP リクエストボディの内容を生成します。 */
      const request = createRequest(true);

      /** HTTP リクエストの送信が成功したかどうかです。 */
      const sent = sendRequest(request);

      // HTTP リクエストの送信が失敗したかをチェックしています。
      if (!sent) {
        // 再送信が行われることになるので ON にします。
        request.retry = true;

        // HTTP リクエスト再送信の待ち行列に追加します。
        state.requests.push(request);
      }
    }

    // 押された直後の再作動を禁止します
    state.allowSubjectiveSwitch = false
    updateDisplay()
    setTimeout(() => {
      state.allowSubjectiveSwitch = true
      updateDisplay()
    }, RESEND_INTERVAL * 1000);
  }
}

function updateDisplay() {
  const {showImage, allowSubjectiveSwitch, relaxState} = state

  if (showImage) {
    const subjectiveSwitchHidden = !allowSubjectiveSwitch ? " hidden" : "";

    el.tileList.class = "horizontal-pad hidden";
    el.image.class = relaxState == RELAX_NONE ? "hidden" : "";
    el.label.class = "";
    el.subjectiveSwitch.class = "text-button primary application-fill" + subjectiveSwitchHidden;
    el.showDetails.class = "text-button secondary application-fill";    
  } else {
    el.tileList.class = "horizontal-pad";
    el.image.class = "hidden";
    el.label.class = "hidden";
    el.subjectiveSwitch.class = "text-button primary application-fill hidden";
    el.showDetails.class = "text-button secondary application-fill hidden";
  }

  const {activeSamplesCount, retentionCount} = state

  switch (relaxState) {
    case RELAX_HIGH:
      el.image.href = imageRelaxHigh
      el.label.text = `高 ${activeSamplesCount} / ${retentionCount}`;
      break
    case RELAX_NORMAL:
      el.image.href = imageRelaxNormal
      el.label.text = `通常 ${activeSamplesCount} / ${retentionCount}`;
      break
    case RELAX_LOW:
      el.image.href = imageRelaxLow
      el.label.text = `低 ${activeSamplesCount} / ${retentionCount}`;
      break
    case RELAX_NONE:
      el.label.text = `蓄積中... ${activeSamplesCount} / ${retentionCount}`;
      break
  }

  const {distance, area} = state

  if (distance && area) {
    const distanceDigits = distance < 1000 ? 1 : 0
    const areaDigits = area < 1000 ? 1 : 0
    el.currentRelax.text = `R:${distance.toFixed(distanceDigits)} (S:${area.toFixed(areaDigits)})`;
  } else {
    el.currentRelax.text = `蓄積中... ${activeSamplesCount} / ${retentionCount}`;
  }
  
  const {preventDetection, detectionCount, subjectiveCount} = state
  const {thresholdHigh, thresholdLow, measureInterval, calculateInterval, retentionPeriod, sendHttp} = state.settings
  const highDigits = thresholdHigh < 1000 ? 1 : 0;
  const lowDigits = thresholdLow < 1000 ? 1 : 0;

  el.thresholdHigh.text = `高しきい値:${thresholdHigh.toFixed(highDigits)}`;
  el.thresholdLow.text = `低しきい値:${thresholdLow.toFixed(lowDigits)}`;
  el.retentionPeriod.text = `計測:${measureInterval}s 算出:${calculateInterval}s 保持:${retentionPeriod}s`
  el.sendHttp.text = `HTTP送信:${sendHttp ? "ON" : "OFF"}`
  el.preventDetection.text = `検出抑制:${preventDetection ? "ON" : "OFF"}`
  el.count.text = `検出:${detectionCount}回 主観:${subjectiveCount}回`
}

function updateClock() {
  const {measureInterval, calculateInterval} = state.settings
  clock.measure = (clock.measure + 1) % measureInterval
  clock.calculate = (clock.calculate + 1) % calculateInterval
  clock.resend = (clock.resend + 1) % RESEND_INTERVAL
}