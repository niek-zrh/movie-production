/**
 * UI copy, centralized for a later locale pass (spec §10).
 * Voice: plain verbs, sentence case; buttons say what happens.
 */
export const copy = {
  appName: "Kinolab",
  tagline: "From forty generations to one approved shot.",

  nav: {
    overview: "Overview",
    board: "Board",
    shots: "Shots",
    review: "Review",
    files: "Files",
    decisions: "Decisions",
    reports: "Reports",
    qc: "QC",
    settings: "Settings",
    team: "Team",
  },

  actions: {
    pick: "Pick this version",
    shortlist: "Shortlist",
    reject: "Reject",
    requestSignOff: "Request sign-off",
    approve: "Approve",
    syncNow: "Sync now",
    openInDrive: "Open in Drive",
    connectDrive: "Connect Google Drive",
    reconnectDrive: "Reconnect Google Drive",
    generateNow: "Generate now",
    publishReport: "Publish report",
    newShot: "New shot",
    newProduction: "New production",
    inviteMember: "Invite member",
    attachToShot: "Attach to shot…",
    addOption: "Add option",
    markAllRead: "Mark all read",
    exportCsv: "Export CSV",
  },

  empty: {
    shots:
      "No shots yet. Paste a list of codes to create them in one go.",
    review: "Nothing waiting for review. Shots appear here when options are ready.",
    files: "No files synced yet. Connect the Drive hub or upload options to a shot.",
    decisions: "No decisions recorded yet. Gates, picks and QC sign-offs land here.",
    reports: "No reports yet. The day's activity is compiled at 18:00, or generate one now.",
    notifications: "You're all caught up.",
    productions: "No productions yet. Set one up to get your overview.",
    qcRuns: "No QC runs yet. Start one when a master is ready for delivery.",
    activity: "No activity yet today.",
  },

  errors: {
    driveExpired: "Drive connection expired — reconnect to continue.",
    fileMissing: "File missing in Drive",
  },
} as const;
