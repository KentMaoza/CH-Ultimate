package com.tokoch.chucompanion;

import java.util.LinkedHashMap;
import java.util.Map;

final class CoreCredentialBoundary {
    static final String SECURE_STORAGE_UNAVAILABLE =
        "Penyimpanan aman Android tidak tersedia. " +
        "Perangkat tidak dapat dipasangkan.";

    private final CoreSecureStateBackend backend;

    CoreCredentialBoundary(CoreSecureStateBackend backend) {
        this.backend = backend;
    }

    String load() {
        requireAvailable();
        try {
            return backend.load();
        } catch (CoreSecurityException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new CoreSecurityException(
                SECURE_STORAGE_UNAVAILABLE,
                error
            );
        }
    }

    void save(String state) {
        requireAvailable();
        try {
            backend.save(state);
        } catch (CoreSecurityException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new CoreSecurityException(
                SECURE_STORAGE_UNAVAILABLE,
                error
            );
        }
    }

    private void requireAvailable() {
        if (!backend.isAvailable()) {
            throw new CoreSecurityException(
                SECURE_STORAGE_UNAVAILABLE
            );
        }
    }

    static Map<String, Object> publicStatus(
        String configuration,
        CoreIdentityState state,
        String message
    ) {
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("production", true);
        status.put("configuration", configuration);
        if (state != null && state.deviceId != null && state.deviceToken != null) {
            status.put("credential", "paired");
            status.put("deviceId", state.deviceId);
        } else if (state != null && state.pairingId != null) {
            status.put("credential", "pending");
            status.put("pairingId", state.pairingId);
        } else {
            status.put("credential", "unpaired");
        }
        if (message != null) status.put("message", message);
        return status;
    }
}
