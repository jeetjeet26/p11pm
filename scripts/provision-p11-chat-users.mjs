console.error(
  [
    "Shared-password Auth provisioning has been retired.",
    "Use the invite-only passwordless flow instead:",
    "1. Verify production SMTP and allowed Auth redirect URLs.",
    "2. Apply the identity_authorization migration.",
    "3. Configure the Before User Created hook as private.hook_restrict_workspace_signup.",
    "4. Issue one-time workspace invites and let each person claim their own account.",
    "This script intentionally does not create, update, or rotate Supabase Auth users.",
  ].join("\n"),
);

process.exitCode = 1;
