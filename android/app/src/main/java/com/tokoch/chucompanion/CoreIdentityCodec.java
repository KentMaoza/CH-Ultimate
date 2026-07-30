package com.tokoch.chucompanion;

import com.getcapacitor.JSObject;
import org.json.JSONException;
import org.json.JSONObject;

final class CoreIdentityCodec {
    private CoreIdentityCodec() {}

    static CoreIdentityState decode(String encoded) {
        CoreIdentityState state = new CoreIdentityState();
        if (encoded == null) return state;
        try {
            JSONObject json = new JSONObject(encoded);
            state.installationId = optional(json, "installationId");
            state.deviceId = optional(json, "deviceId");
            state.deviceToken = optional(json, "deviceToken");
            state.pairingCode = optional(json, "pairingCode");
            state.pairingRequestId = optional(json, "pairingRequestId");
            state.pairingClaimSecret = optional(
                json,
                "pairingClaimSecret"
            );
            state.pairingDisplayName = optional(
                json,
                "pairingDisplayName"
            );
            state.pairingId = optional(json, "pairingId");
            state.pendingDeviceToken = optional(
                json,
                "pendingDeviceToken"
            );
            state.pendingRotationToken = optional(
                json,
                "pendingRotationToken"
            );
            return state;
        } catch (JSONException error) {
            throw new CoreSecurityException(
                CoreCredentialBoundary.SECURE_STORAGE_UNAVAILABLE,
                error
            );
        }
    }

    static String encode(CoreIdentityState state) {
        JSObject json = new JSObject();
        put(json, "installationId", state.installationId);
        put(json, "deviceId", state.deviceId);
        put(json, "deviceToken", state.deviceToken);
        put(json, "pairingCode", state.pairingCode);
        put(json, "pairingRequestId", state.pairingRequestId);
        put(json, "pairingClaimSecret", state.pairingClaimSecret);
        put(json, "pairingDisplayName", state.pairingDisplayName);
        put(json, "pairingId", state.pairingId);
        put(json, "pendingDeviceToken", state.pendingDeviceToken);
        put(
            json,
            "pendingRotationToken",
            state.pendingRotationToken
        );
        return json.toString();
    }

    private static String optional(JSONObject json, String key) {
        String value = json.optString(key, null);
        return value == null || value.isEmpty() ? null : value;
    }

    private static void put(
        JSObject json,
        String key,
        String value
    ) {
        if (value != null) json.put(key, value);
    }
}
