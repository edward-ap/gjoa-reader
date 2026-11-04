import { Dialog } from "./Dialog.js";

export class MessageBox {
  static async show(options = {}) {
    const dialog = new Dialog({
      title:options.title ?? "Message",
      content:options.message ?? options.content ?? "",
      buttons:options.buttons ?? [{ text:"OK", result:"ok", primary:true }],
      cancelResult:options.cancelResult ?? "cancel",
      closeable:options.closeable
    });
    try {
      return await dialog.showModal({ origin:options.origin ?? "api" });
    } finally {
      dialog.destroy();
    }
  }

  static confirm(message, options = {}) {
    return this.show({
      ...options,
      message,
      title:options.title ?? "Confirm",
      buttons:options.buttons ?? [
        { text:options.okText ?? "OK", result:"ok", primary:true },
        { text:options.cancelText ?? "Cancel", result:"cancel" }
      ]
    });
  }

  static alert(message, options = {}) {
    return this.show({ ...options, message, buttons:[{ text:options.okText ?? "OK", result:"ok", primary:true }] });
  }
}
