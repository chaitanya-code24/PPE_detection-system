"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, clearToken, getToken, isTokenExpired } from "@/lib/api";

type SmsConfig = {
  receiver_number: string;
  enabled: boolean;
};

type EmailConfig = {
  receiver_email: string;
  enabled: boolean;
};

type SmsLog = {
  id: number;
  camera_id: string;
  to_number: string;
  message: string;
  status: "success" | "failed";
  detail: string;
  provider_id: string;
  is_test: boolean;
  created_at: string | null;
};

type EmailLog = {
  id: number;
  camera_id: string;
  to_email: string;
  subject: string;
  message: string;
  status: "success" | "failed";
  detail: string;
  is_test: boolean;
  created_at: string | null;
};

type UnifiedLog = {
  key: string;
  channel: "sms" | "email";
  created_at: string | null;
  is_test: boolean;
  camera_id: string;
  target: string;
  status: "success" | "failed";
  provider: string;
  detail: string;
};

export default function NotificationsPage() {
  const router = useRouter();
  const [smsConfig, setSmsConfig] = useState<SmsConfig>({ receiver_number: "", enabled: false });
  const [emailConfig, setEmailConfig] = useState<EmailConfig>({ receiver_email: "", enabled: false });

  const [savingSms, setSavingSms] = useState(false);
  const [testingSms, setTestingSms] = useState(false);
  const [smsStatus, setSmsStatus] = useState<string>("");

  const [savingEmail, setSavingEmail] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string>("");
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);

  const unifiedLogs: UnifiedLog[] = [
    ...smsLogs.map((log) => ({
      key: `sms-${log.id}`,
      channel: "sms" as const,
      created_at: log.created_at,
      is_test: log.is_test,
      camera_id: log.camera_id,
      target: log.to_number,
      status: log.status,
      provider: log.provider_id || "-",
      detail: log.detail,
    })),
    ...emailLogs.map((log) => ({
      key: `email-${log.id}`,
      channel: "email" as const,
      created_at: log.created_at,
      is_test: log.is_test,
      camera_id: log.camera_id,
      target: log.to_email,
      status: log.status,
      provider: log.subject || "-",
      detail: log.detail,
    })),
  ].sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bt - at;
  });

  const handleAuthError = () => {
    clearToken();
    router.push("/signin");
  };

  const authHeader = () => {
    const token = getToken();
    if (!token || isTokenExpired(token)) {
      handleAuthError();
      return null;
    }
    return { Authorization: `Bearer ${token}` };
  };

  useEffect(() => {
    const load = async () => {
      const headers = authHeader();
      if (!headers) return;

      try {
        const [smsRes, emailRes] = await Promise.all([
          fetch(`${API_BASE}/notifications/sms`, { headers }),
          fetch(`${API_BASE}/notifications/email`, { headers }),
        ]);

        if (smsRes.status === 401 || emailRes.status === 401) return handleAuthError();

        if (smsRes.ok) {
          const data = await smsRes.json();
          setSmsConfig({
            receiver_number: data.receiver_number ?? "",
            enabled: !!data.enabled,
          });
        }

        if (emailRes.ok) {
          const data = await emailRes.json();
          setEmailConfig({
            receiver_email: data.receiver_email ?? "",
            enabled: !!data.enabled,
          });
        }
      } catch {
        setSmsStatus("Unable to load notification config. Check network/server.");
      }
    };

    void load();
  }, []);

  useEffect(() => {
    const loadLogs = async () => {
      const headers = authHeader();
      if (!headers) return;

      try {
        const [smsRes, emailRes] = await Promise.all([
          fetch(`${API_BASE}/notifications/sms/logs?limit=30`, { headers }),
          fetch(`${API_BASE}/notifications/email/logs?limit=30`, { headers }),
        ]);

        if (smsRes.status === 401 || emailRes.status === 401) return handleAuthError();

        if (smsRes.ok) {
          const data = await smsRes.json();
          setSmsLogs(Array.isArray(data.logs) ? data.logs : []);
        }
        if (emailRes.ok) {
          const data = await emailRes.json();
          setEmailLogs(Array.isArray(data.logs) ? data.logs : []);
        }
      } catch {
        // Keep last good logs visible; retry on next interval tick.
      }
    };

    void loadLogs();
    const id = window.setInterval(() => {
      void loadLogs();
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  const saveSms = async () => {
    const headers = authHeader();
    if (!headers) return;

    setSavingSms(true);
    setSmsStatus("");
    try {
      const res = await fetch(`${API_BASE}/notifications/sms`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(smsConfig),
      });

      if (res.status === 401) return handleAuthError();

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSmsStatus(err.detail || "Failed to save SMS config");
        return;
      }

      setSmsStatus("SMS configuration saved.");
    } catch {
      setSmsStatus("Failed to save SMS config. Check network/server.");
    } finally {
      setSavingSms(false);
    }
  };

  const testSms = async () => {
    const headers = authHeader();
    if (!headers) return;

    setTestingSms(true);
    setSmsStatus("");
    try {
      const res = await fetch(`${API_BASE}/notifications/sms/test`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "" }),
      });

      if (res.status === 401) return handleAuthError();

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSmsStatus(err.detail || "Test SMS failed");
        return;
      }

      setSmsStatus("Test SMS sent successfully.");
    } catch {
      setSmsStatus("Test SMS failed. Check network/server.");
    } finally {
      setTestingSms(false);
    }
  };

  const saveEmail = async () => {
    const headers = authHeader();
    if (!headers) return;

    setSavingEmail(true);
    setEmailStatus("");
    try {
      const res = await fetch(`${API_BASE}/notifications/email`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailConfig),
      });

      if (res.status === 401) return handleAuthError();

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setEmailStatus(err.detail || "Failed to save Email config");
        return;
      }

      setEmailStatus("Email configuration saved.");
    } catch {
      setEmailStatus("Failed to save Email config. Check network/server.");
    } finally {
      setSavingEmail(false);
    }
  };

  const testEmail = async () => {
    const headers = authHeader();
    if (!headers) return;

    setTestingEmail(true);
    setEmailStatus("");
    try {
      const res = await fetch(`${API_BASE}/notifications/email/test`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subject: "", message: "" }),
      });

      if (res.status === 401) return handleAuthError();

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setEmailStatus(err.detail || "Test Email failed");
        return;
      }

      setEmailStatus("Test Email sent successfully.");
    } catch {
      setEmailStatus("Test Email failed. Check network/server.");
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900">Notifications</h1>
        <p className="text-sm text-gray-600">Configure SMS and Email channels for fall alerts.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">SMS Alerts</h2>
          <p className="mb-4 text-xs text-gray-500">Sender number is fixed from backend environment.</p>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">Receiver mobile number</label>
            <input
              value={smsConfig.receiver_number}
              onChange={(e) => setSmsConfig((prev) => ({ ...prev, receiver_number: e.target.value }))}
              placeholder="+15557654321"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <label className="mb-5 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={smsConfig.enabled}
              onChange={(e) => setSmsConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            Enable SMS alerts
          </label>

          <div className="flex gap-3">
            <button
              onClick={() => void saveSms()}
              disabled={savingSms}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:bg-gray-400"
            >
              {savingSms ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => void testSms()}
              disabled={testingSms}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {testingSms ? "Sending..." : "Send Test SMS"}
            </button>
          </div>

          {smsStatus && <p className="mt-4 text-sm text-gray-700">{smsStatus}</p>}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Email Alerts</h2>
          <p className="mb-4 text-xs text-gray-500">Sender email is fixed from backend environment.</p>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">Receiver email</label>
            <input
              value={emailConfig.receiver_email}
              onChange={(e) => setEmailConfig((prev) => ({ ...prev, receiver_email: e.target.value }))}
              placeholder="security@company.com"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <label className="mb-5 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={emailConfig.enabled}
              onChange={(e) => setEmailConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            Enable Email alerts
          </label>

          <div className="flex gap-3">
            <button
              onClick={() => void saveEmail()}
              disabled={savingEmail}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:bg-gray-400"
            >
              {savingEmail ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => void testEmail()}
              disabled={testingEmail}
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {testingEmail ? "Sending..." : "Send Test Email"}
            </button>
          </div>

          {emailStatus && <p className="mt-4 text-sm text-gray-700">{emailStatus}</p>}
        </div>
      </div>

      <div className="mt-8">
        <div className="flex h-[calc(100vh-22rem)] min-h-[420px] flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Delivery Logs</h2>
            <p className="text-xs text-gray-500">Unified timeline for SMS and Email auto-alert/test delivery status.</p>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Channel</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Camera</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">To</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Ref</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Detail</th>
                </tr>
              </thead>
              <tbody>
                {unifiedLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                      No delivery logs yet.
                    </td>
                  </tr>
                ) : (
                  unifiedLogs.map((log) => (
                    <tr key={log.key} className="border-t border-gray-100">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{log.created_at ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            log.channel === "sms" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"
                          }`}
                        >
                          {log.channel.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">{log.is_test ? "test" : "auto"}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{log.camera_id || "-"}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{log.target}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            log.status === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{log.provider}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{log.detail}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
