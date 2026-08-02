package com.tokoch.chucompanion;

import java.net.URI;
import java.net.URISyntaxException;

final class CoreEndpointPolicy {
    private static final String APPROVED_ENDPOINT =
        "https://192.168.50.14:8443";

    private CoreEndpointPolicy() {}

    static URI requireApproved(String endpoint) {
        try {
            URI parsed = new URI(endpoint);
            if (
                !"https".equals(parsed.getScheme()) ||
                !"192.168.50.14".equals(parsed.getHost()) ||
                parsed.getPort() != 8443 ||
                parsed.getUserInfo() != null ||
                (parsed.getRawPath() != null && !parsed.getRawPath().isEmpty()) ||
                parsed.getRawQuery() != null ||
                parsed.getRawFragment() != null ||
                !endpoint.equals(parsed.toString()) ||
                !APPROVED_ENDPOINT.equals(endpoint)
            ) {
                throw new CoreSecurityException(
                    "Konfigurasi CH Core tidak valid."
                );
            }
            return parsed;
        } catch (
            NullPointerException |
            NumberFormatException |
            URISyntaxException error
        ) {
            throw new CoreSecurityException(
                "Konfigurasi CH Core tidak valid.",
                error
            );
        }
    }
}
