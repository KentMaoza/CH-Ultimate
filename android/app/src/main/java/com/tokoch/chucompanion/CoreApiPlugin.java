package com.tokoch.chucompanion;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.json.JSONObject;

@CapacitorPlugin(name = "CoreApi")
public final class CoreApiPlugin extends Plugin {
    private static final Pattern UUID_PATTERN = Pattern.compile(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-" +
        "[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
    );
    private static final Set<String> REQUEST_KEYS = Set.of(
        "method",
        "path",
        "body",
        "idempotencyKey"
    );
    private final SecureRandom random = new SecureRandom();
    private CoreCredentialBoundary credentials;

    @Override
    public void load() {
        credentials = new CoreCredentialBoundary(
            new CoreAndroidSecureStateBackend(getContext())
        );
    }

    @PluginMethod
    public void credentialStatus(PluginCall call) {
        try {
            CoreDeploymentConfig config =
                CoreDeploymentConfig.load(getContext());
            if (config == null) {
                call.resolve(
                    toJsObject(
                        CoreCredentialBoundary.publicStatus(
                            "missing",
                            null,
                            "Konfigurasi CH Core Android belum tersedia."
                        )
                    )
                );
                return;
            }
            CoreIdentityState state = loadState();
            call.resolve(
                toJsObject(
                    CoreCredentialBoundary.publicStatus(
                        "ready",
                        state,
                        null
                    )
                )
            );
        } catch (CoreSecurityException error) {
            call.resolve(
                toJsObject(
                    CoreCredentialBoundary.publicStatus(
                        isSecureStorageFailure(error)
                            ? "ready"
                            : "invalid",
                        null,
                        safeMessage(error)
                    )
                )
            );
        }
    }

    @PluginMethod
    public void request(PluginCall call) {
        try {
            rejectUnknownKeys(call);
            String method = call.getString("method");
            String path = call.getString("path");
            Object body = call.getData().opt("body");
            String idempotencyKey = call.getString(
                "idempotencyKey"
            );
            boolean hasBody = body != null && body != JSONObject.NULL;
            boolean hasIdempotencyKey = idempotencyKey != null;
            CoreRequestPolicy.requireApproved(
                method,
                path,
                hasBody,
                hasIdempotencyKey
            );
            if (
                idempotencyKey != null &&
                !UUID_PATTERN.matcher(idempotencyKey).matches()
            ) {
                throw new CoreSecurityException(
                    "Permintaan CH Core tidak valid."
                );
            }
            CoreIdentityState state = loadState();
            if (state.deviceId == null || state.deviceToken == null) {
                throw new CoreSecurityException(
                    "Perangkat CH Core belum dipasangkan."
                );
            }
            CoreApiClient.Response response = client().send(
                method,
                path,
                body,
                idempotencyKey,
                "Bearer " + state.deviceToken
            );
            call.resolve(toJsResponse(response));
        } catch (CoreSecurityException error) {
            call.reject(safeMessage(error));
        }
    }

    @PluginMethod
    public void claimPairing(PluginCall call) {
        try {
            String code = call.getString("code", "");
            String displayName = requireDisplayName(
                call.getString("displayName", "")
            );
            if (!code.matches("^\\d{8}$")) {
                throw new CoreSecurityException(
                    "Kode pemasangan harus terdiri dari 8 angka."
                );
            }
            CoreIdentityState state = loadState();
            if (
                !code.equals(state.pairingCode) ||
                !displayName.equals(state.pairingDisplayName)
            ) {
                state.pairingCode = code;
                state.pairingDisplayName = displayName;
                state.pairingRequestId = UUID.randomUUID().toString();
                state.pairingClaimSecret = randomSecret();
                state.pairingId = null;
                state.pendingDeviceToken = null;
                saveState(state);
            }
            if (state.pairingId == null) {
                JSObject body = new JSObject();
                body.put("phase", "claim");
                body.put("code", state.pairingCode);
                body.put("requestId", state.pairingRequestId);
                body.put(
                    "claimSecret",
                    state.pairingClaimSecret
                );
                body.put("installationId", state.installationId);
                body.put("displayName", state.pairingDisplayName);
                body.put("platform", "android");
                CoreApiClient.Response response = client().send(
                    "POST",
                    "/v1/pairings/redeem",
                    body,
                    null,
                    null
                );
                JSONObject responseBody = requireObject(
                    response,
                    202
                );
                String pairingId = requireUuid(
                    responseBody.optString("pairingId", "")
                );
                if (!"pending".equals(responseBody.optString("status"))) {
                    throw invalidIdentityResponse();
                }
                state.pairingId = pairingId;
                saveState(state);
            }
            call.resolve(
                new JSObject()
                    .put("status", "pending")
                    .put("pairingId", state.pairingId)
            );
        } catch (CoreSecurityException error) {
            call.reject(safeMessage(error));
        }
    }

    @PluginMethod
    public void completePairing(PluginCall call) {
        try {
            CoreIdentityState state = loadState();
            if (
                state.pairingId == null ||
                state.pairingClaimSecret == null
            ) {
                throw new CoreSecurityException(
                    "Permintaan pemasangan belum tersedia."
                );
            }
            if (state.pendingDeviceToken == null) {
                state.pendingDeviceToken = randomSecret();
                saveState(state);
            }
            JSObject body = new JSObject();
            body.put("phase", "complete");
            body.put("pairingId", state.pairingId);
            body.put("claimSecret", state.pairingClaimSecret);
            body.put("deviceToken", state.pendingDeviceToken);
            CoreApiClient.Response response = client().send(
                "POST",
                "/v1/pairings/redeem",
                body,
                null,
                null
            );
            JSONObject device = requireObject(response, 200)
                .optJSONObject("device");
            if (device == null) throw invalidIdentityResponse();
            state.deviceId = requireUuid(
                device.optString("id", "")
            );
            state.deviceToken = state.pendingDeviceToken;
            clearPairing(state);
            saveState(state);
            call.resolve(
                new JSObject()
                    .put("status", "paired")
                    .put("deviceId", state.deviceId)
            );
        } catch (CoreSecurityException error) {
            call.reject(safeMessage(error));
        }
    }

    @PluginMethod
    public void rotateToken(PluginCall call) {
        try {
            CoreIdentityState state = loadState();
            if (state.deviceId == null || state.deviceToken == null) {
                throw new CoreSecurityException(
                    "Perangkat CH Core belum dipasangkan."
                );
            }
            if (state.pendingRotationToken == null) {
                state.pendingRotationToken = randomSecret();
                saveState(state);
            }
            JSObject body = new JSObject();
            body.put(
                "nextDeviceToken",
                state.pendingRotationToken
            );
            CoreApiClient.Response response = client().send(
                "POST",
                "/v1/auth/token/rotate",
                body,
                null,
                "Bearer " + state.deviceToken
            );
            JSONObject device = requireObject(response, 200)
                .optJSONObject("device");
            if (
                device == null ||
                !state.deviceId.equals(device.optString("id"))
            ) {
                throw invalidIdentityResponse();
            }
            state.deviceToken = state.pendingRotationToken;
            state.pendingRotationToken = null;
            saveState(state);
            call.resolve(new JSObject().put("status", "rotated"));
        } catch (CoreSecurityException error) {
            call.reject(safeMessage(error));
        }
    }

    private CoreApiClient client() {
        CoreDeploymentConfig config =
            CoreDeploymentConfig.load(getContext());
        if (config == null) {
            throw new CoreSecurityException(
                "Konfigurasi CH Core Android belum tersedia."
            );
        }
        return new CoreApiClient(getContext(), config);
    }

    private CoreIdentityState loadState() {
        CoreIdentityState state = CoreIdentityCodec.decode(
            credentials.load()
        );
        if (state.installationId == null) {
            state.installationId = UUID.randomUUID().toString();
            saveState(state);
        }
        return state;
    }

    private void saveState(CoreIdentityState state) {
        credentials.save(CoreIdentityCodec.encode(state));
    }

    private void rejectUnknownKeys(PluginCall call) {
        Iterator<String> keys = call.getData().keys();
        while (keys.hasNext()) {
            if (!REQUEST_KEYS.contains(keys.next())) {
                throw new CoreSecurityException(
                    "Permintaan CH Core tidak valid."
                );
            }
        }
    }

    private static String requireDisplayName(String input) {
        String value = input.trim();
        if (value.isEmpty() || value.length() > 160) {
            throw new CoreSecurityException(
                "Nama perangkat tidak valid."
            );
        }
        return value;
    }

    private static String requireUuid(String value) {
        if (!UUID_PATTERN.matcher(value).matches()) {
            throw invalidIdentityResponse();
        }
        return value;
    }

    private static JSONObject requireObject(
        CoreApiClient.Response response,
        int expectedStatus
    ) {
        if (
            response.status != expectedStatus ||
            !(response.body instanceof JSONObject)
        ) {
            throw invalidIdentityResponse();
        }
        return (JSONObject) response.body;
    }

    private String randomSecret() {
        byte[] value = new byte[32];
        random.nextBytes(value);
        return Base64
            .getUrlEncoder()
            .withoutPadding()
            .encodeToString(value);
    }

    private static void clearPairing(CoreIdentityState state) {
        state.pairingCode = null;
        state.pairingRequestId = null;
        state.pairingClaimSecret = null;
        state.pairingDisplayName = null;
        state.pairingId = null;
        state.pendingDeviceToken = null;
    }

    private static CoreSecurityException invalidIdentityResponse() {
        return new CoreSecurityException(
            "Respons identitas CH Core tidak valid."
        );
    }

    private static boolean isSecureStorageFailure(
        CoreSecurityException error
    ) {
        return CoreCredentialBoundary.SECURE_STORAGE_UNAVAILABLE.equals(
            error.getMessage()
        );
    }

    private static String safeMessage(CoreSecurityException error) {
        String message = error.getMessage();
        return message == null
            ? "CH Core belum dapat dihubungkan."
            : message;
    }

    private static JSObject toJsResponse(
        CoreApiClient.Response response
    ) {
        return new JSObject()
            .put("status", response.status)
            .put("body", response.body);
    }

    private static JSObject toJsObject(Map<String, Object> values) {
        JSObject result = new JSObject();
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            result.put(entry.getKey(), entry.getValue());
        }
        return result;
    }
}
