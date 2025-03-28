function HelloWorld(props) {
  return (
    <Page>
      <TextInput label="心拍数データの計測間隔[秒]" placeholder="例：1" settingsKey="measureInterval" type="number"/>
      <TextInput label="リラックス傾向の算出・更新間隔[秒]" placeholder="例：1" settingsKey="calculateInterval" type="number"/>
      <TextInput label="心拍数データの保持時間[秒]" placeholder="例：600" settingsKey="retentionPeriod" type="number"/>
      <TextInput label="高リラックス状態の閾値" placeholder="例：1000" settingsKey="thresholdHigh" type="number"/>
      <TextInput label="低リラックス状態の閾値" placeholder="例：800" settingsKey="thresholdLow" type="number"/>
      <Toggle settingsKey="sendHttp" label="低リラックス検出時のHTTPリクエスト送信"/>
      <TextInput label="HTTPリクエストのURL" placeholder="例：https://example.com/api" settingsKey="sendUrl" type="url" disabled={!(props.settings.sendHttp === 'true')}/>
    </Page>
  );
}

registerSettingsPage(HelloWorld);
