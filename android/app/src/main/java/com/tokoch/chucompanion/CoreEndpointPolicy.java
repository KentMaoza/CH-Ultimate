package com.tokoch.chucompanion;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class CoreEndpointPolicy {
    private static final Pattern LAN_HOST =
        Pattern.compile("^192\\.168\\.1\\.(\\d{1,3})$");

    private CoreEndpointPolicy() {}

    static URI requireApproved(String endpoint) {
        try {
            URI parsed = new URI(endpoint);
            Matcher host = LAN_HOST.matcher(
                parsed.getHost() == null ? "" : parsed.getHost()
            );
            if (
                !"https".equals(parsed.getScheme()) ||
                !host.matches() ||
                Integer.parseInt(host.group(1)) < 1 ||
                Integer.parseInt(host.group(1)) > 254 ||
                parsed.getPort() != 8443 ||
                parsed.getUserInfo() != null ||
                (parsed.getRawPath() != null && !parsed.getRawPath().isEmpty()) ||
                parsed.getRawQuery() != null ||
                parsed.getRawFragment() != null ||
                !endpoint.equals(parsed.toString())
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
