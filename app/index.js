import { me as appbit } from "appbit";
import * as document from "document";
import * as fs from "fs";
import { HeartRateSensor } from "heart-rate";
import { display } from "display";
import { vibration } from "haptics";
import * as messaging from "messaging";

appbit.appTimeoutEnabled = false;

const SETTINGS_FILE = "settings.json";
const RESEND_INTERVAL = 5000;
//const MIN_SAMPLES = 2;
const VIBRATION_TIME = 1000;

const imageRelaxMissingSamples = "blank.png";
const imageRelaxHigh = "high_clear.png";
const imageRelaxNormal = "normal_clear.png";
const imageRelaxLow = "low_clear.png";

const textRelaxHigh = "リラックス：高";
const textRelaxNormal = "リラックス：通常";
const textRelaxLow = "リラックス：低";

const subjectiveSwitchClasses = "text-button primary application-fill";
const showDetailsClasses = "text-button secondary application-fill";

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
  currentRelax: null,
  samples: [],
  requests: [],
  preventDetection: false,
  detectionCount: 0,
  subjectiveCount: 0,
  showImage: true,
  allowSubjectiveSwitch: false, // 主観スイッチの作動を許可
  pressedSubjectiveSwitch: false, // 主観スイッチが押された直後の再作動を禁止
};

setup();

function setup() {
  displayPreventDetection();
  displayCount();
  displayTileList();
  displayImage();
  updateSettings(loadSettings());
  registerHandlers();
}

function registerHandlers() {
  if (HeartRateSensor) {
    state.hrm = new HeartRateSensor({ frequency: 1 });
    state.hrm.addEventListener("reading", onReading);
    state.hrm.start();
  }

  el.subjectiveSwitch.addEventListener("click", onClickSubjectiveSwitch);

  messaging.peerSocket.addEventListener("message", onMessage);
  setInterval(onTimeout, RESEND_INTERVAL);

  el.tileList.addEventListener("click", onClickTileList)
  el.showDetails.addEventListener("click", onClickShowDetails);
}

function loadSettings() {
  const defaultSettings = {
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
  displaySettings();
}

function onReading() {
  const { heartRate } = state.hrm;

  if (!heartRate) {
    return;
  }

  appendSample(heartRate);
  removeSamples();

  if (state.samples.length == state.settings.retentionPeriod) {
    state.allowSubjectiveSwitch = !state.pressedSubjectiveSwitch;
    calculateRelax();
    detectLowRelax();
    disablePreventDetection();
  } else {
    state.allowSubjectiveSwitch = false;
  }

  displayRelax();
  displayRelaxImage();
  displayCount();
  displayPreventDetection();
}

function appendSample(heartRate) {
  const time = new Date().getTime();
  const duration = 60 * 1000 / heartRate;
  const sample = [time, duration];

  state.samples.push(sample);
}

function removeSamples() {
  const retentionPeriod = state.settings.retentionPeriod * 1000;
  const retentionTime = new Date().getTime() - retentionPeriod;

  state.samples = state.samples.filter(sample => {
      const [time] = sample;
      return time >= retentionTime;
    })
    .slice(-state.settings.retentionPeriod);
}

function calculateRelax() {
  const { samples } = state;
  const n = samples.length;
  const sum = samples.reduce((memo, sample) => {
    const [, duration] = sample;
    return memo + duration;
  }, 0);

  const sampleFirst = samples[0];
  const sampleLast = samples[samples.length - 1];
  const [, durationFirst] = sampleFirst;
  const [, durationLast] = sampleLast;

  const centerX = (sum - durationLast) / (n - 1);
  const centerY = (sum - durationFirst) / (n - 1);
  const relax = Math.sqrt(centerX * centerX + centerY * centerY);

  state.currentRelax = relax;
}

function detectLowRelax() {
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
  if (!state.preventDetection) {
    // 現在のリラックス傾向が低リラックス状態のしきい値よりも低いかをチェックしています。
    if (state.currentRelax < state.settings.thresholdLow) {
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

      // 低リラックス状態の検出抑制フラグを ON にします。
      state.preventDetection = true;
    }
  }
}

function disablePreventDetection() {
  if (state.currentRelax > state.settings.thresholdHigh) {
    state.preventDetection = false;
  }
}

function notify() {
  if (vibration.start("nudge")) {
    setTimeout(() => vibration.stop(), VIBRATION_TIME);
  }

  display.on = true;
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
    state.allowSubjectiveSwitch = false;
    state.pressedSubjectiveSwitch = true;
    setTimeout(() => state.pressedSubjectiveSwitch = false, RESEND_INTERVAL);

    displayRelaxImage();
    displayCount();
  }
}

function createRequest(subjective) {
  /** HTTPリクエストボディの生成 */
  return {
    /** 送信日時 */
    date: new Date().toISOString(),
    /** 現在のリラックス傾向 */
    relax: state.currentRelax,
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

function onTimeout() {
  while (state.requests.length >= 1) {
    const [request] = state.requests;
    const sent = sendRequest(request);

    if (!sent) {
      return;
    }

    state.requests.shift();
  }
}

function onClickTileList() {
  state.showImage = true;
  displayTileList();
  displayImage();
}

function onClickShowDetails() {
  state.showImage = false;
  displayTileList();
  displayImage();
}

function displaySettings() {
  const { settings } = state;

  const highDigits = settings.thresholdHigh < 1000 ? 1 : 0;
  const lowDigits = settings.thresholdLow < 1000 ? 1 : 0;
  el.thresholdHigh.text = `高しきい値:${settings.thresholdHigh.toFixed(highDigits)}`;
  el.thresholdLow.text = `低しきい値:${settings.thresholdLow.toFixed(lowDigits)}`;
  el.retentionPeriod.text = `保持期間:${settings.retentionPeriod}秒`;
  el.sendHttp.text = `HTTP送信:${settings.sendHttp ? "ON" : "OFF"}`;
}

function displayRelax() {
  if (state.samples.length < state.settings.retentionPeriod) {
    el.currentRelax.text = `蓄積中... ${state.samples.length} / ${state.settings.retentionPeriod}`;
  } else {
    const digits = state.currentRelax < 1000 ? 1 : 0;
    el.currentRelax.text = `リラックス傾向:${state.currentRelax.toFixed(digits)}`;
  }
}

function displayPreventDetection() {
  el.preventDetection.text = `検出抑制:${
    state.preventDetection ? "ON" : "OFF"
  }`;
}

function displayCount() {
  el.count.text = `検出:${state.detectionCount}回 主観:${state.subjectiveCount}回`;
}

function displayTileList() {
  if (state.showImage) {
    el.tileList.class = "horizontal-pad hidden";
  } else {
    el.tileList.class = "horizontal-pad";
  }
}

function displayImage() {
  if (state.showImage) {
    const hidden = state.allowSubjectiveSwitch ? "" : " hidden";
    
    el.image.class = "";
    el.label.class ="";
    el.subjectiveSwitch.class = subjectiveSwitchClasses + hidden;
    el.showDetails.class = showDetailsClasses;
  } else {
    el.image.class = "hidden";
    el.label.class = "hidden";
    el.subjectiveSwitch.class = subjectiveSwitchClasses + " hidden";
    el.showDetails.class = showDetailsClasses + " hidden";
  }
}

function displayRelaxImage() {
  const hidden = state.showImage && state.allowSubjectiveSwitch ? "" : " hidden";
  el.subjectiveSwitch.class = subjectiveSwitchClasses + hidden;

  if (state.samples.length < state.settings.retentionPeriod) {
    el.image.href = imageRelaxMissingSamples;
    el.label.text = `蓄積中... ${state.samples.length} / ${state.settings.retentionPeriod}`;
  } else if (state.currentRelax < state.settings.thresholdLow) {
    el.image.href = imageRelaxLow;
    el.label.text = textRelaxLow;
  } else if (state.currentRelax > state.settings.thresholdHigh) {
    el.image.href = imageRelaxHigh;
    el.label.text = textRelaxHigh;
  } else {
    el.image.href = imageRelaxNormal;
    el.label.text = textRelaxNormal;
  }
}
