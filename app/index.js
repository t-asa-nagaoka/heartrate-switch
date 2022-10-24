import * as messaging from "messaging";
import * as document from "document";

const el = {
  currentRelax: document.getElementById("currentRelax"),
  thresholdHigh: document.getElementById("thresholdHigh"),
  thresholdLow: document.getElementById("thresholdLow"),
  retensionPeriod: document.getElementById("retentionPeriod"),
  sendHttp: document.getElementById("sendHttp"),
  preventDetection: document.getElementById("preventDetection"),
  sendCount: document.getElementById("sendCount"),
};

messaging.peerSocket.addEventListener("message", (event) => {
  console.log(JSON.stringify(event.data));
  if (event && event.data && event.data.type === "settings") {
  }
});
