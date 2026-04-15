const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  // Who performed the action (admin/superadmin username)
  actor: { type: String, required: true },
  actorRole: { type: String, default: "admin" },
  // What action
  action: {
    type: String,
    required: true,
    enum: [
      "create_user",
      "delete_user",
      "reset_pin",
      "delete_item",
      "delete_all_items",
      "delete_all_transactions",
      "clear_worker_phone",
      "remove_user_from_app",
      "remove_backup",
      "archive_user_data",
      "other",
    ],
  },
  // Target (username of affected user, item code, etc.)
  target: { type: String, default: "" },
  // Free-form detail string
  detail: { type: String, default: "" },
  // Source: 'admin_panel', 'superadmin_panel', 'mobile_app'
  source: { type: String, default: "admin_panel" },
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
