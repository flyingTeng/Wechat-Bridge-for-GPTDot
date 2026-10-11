using Workerd = import "../../node_modules/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "internet", network = (allow = [])),
    (name = "native-client-test", worker = (
      compatibilityDate = "2026-05-15",
      globalOutbound = (name = "tencent-fixture"),
      modules = [
        (name = "test.mjs", esModule = embed "native-client.mjs"),
        (name = "wechat.mjs", esModule = embed "../../lib/wechat.mjs"),
        (name = "notifications.mjs", esModule = embed "../../lib/notifications.mjs"),
        (name = "http.mjs", esModule = embed "../../lib/http.mjs"),
        (name = "inbound.mjs", esModule = embed "../../lib/inbound.mjs")
      ]
    )),
    (name = "tencent-fixture", worker = (
      compatibilityDate = "2026-05-15",
      modules = [(name = "fixture.mjs", esModule = embed "tencent-fixture.mjs")]
    ))
  ]
);
