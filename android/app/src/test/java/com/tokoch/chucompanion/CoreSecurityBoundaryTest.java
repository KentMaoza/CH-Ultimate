package com.tokoch.chucompanion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.net.URI;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.Test;

public class CoreSecurityBoundaryTest {

    @Test
    public void endpointPolicyAcceptsOnlyFixedHttpsBusinessLanOrigin() {
        URI endpoint = CoreEndpointPolicy.requireApproved("https://192.168.1.14:8443");

        assertEquals("https", endpoint.getScheme());
        assertEquals("192.168.1.14", endpoint.getHost());
        assertEquals(8443, endpoint.getPort());

        for (String rejected : new String[] {
            "http://192.168.1.14:8443",
            "https://192.168.1.14",
            "https://core.local:8443",
            "https://192.168.2.14:8443",
            "https://127.0.0.1:8443",
            "https://192.168.1.14:8443/v1",
            "https://user:pass@192.168.1.14:8443"
        }) {
            assertThrows(
                CoreSecurityException.class,
                () -> CoreEndpointPolicy.requireApproved(rejected)
            );
        }
    }

    @Test
    public void requestPolicyAllowsOnlyApprovedMethodAndRelativeRoutePairs() {
        CoreRequestPolicy.requireApproved("GET", "/v1/bootstrap", false, false);
        CoreRequestPolicy.requireApproved(
            "GET",
            "/v1/changes?after=0&limit=500",
            false,
            false
        );
        CoreRequestPolicy.requireApproved(
            "PATCH",
            "/v1/notas/11111111-1111-4111-8111-111111111111/header",
            true,
            true
        );
        CoreRequestPolicy.requireApproved(
            "GET",
            "/v1/images/" + "a".repeat(64),
            false,
            false
        );
        CoreRequestPolicy.requireApproved(
            "POST",
            "/v1/skus/11111111-1111-4111-8111-111111111111/image",
            true,
            true
        );

        for (String path : new String[] {
            "https://192.168.1.14:8443/v1/bootstrap",
            "//192.168.1.14:8443/v1/bootstrap",
            "/v1/../bootstrap",
            "/v1/%2e%2e/bootstrap",
            "/v1/not-a-route",
            "/v1/images",
            "/v1/images/" + "a".repeat(63),
            "/v1/changes?limit=500&after=0"
        }) {
            assertThrows(
                CoreSecurityException.class,
                () -> CoreRequestPolicy.requireApproved("GET", path, false, false)
            );
        }
        assertThrows(
            CoreSecurityException.class,
            () -> CoreRequestPolicy.requireApproved("POST", "/v1/bootstrap", false, false)
        );
    }

    @Test
    public void credentialBoundaryFailsWhenAndroidKeystoreIsUnavailable() {
        CoreSecureStateBackend unavailable = new CoreSecureStateBackend() {
            @Override
            public boolean isAvailable() {
                return false;
            }

            @Override
            public String load() {
                return null;
            }

            @Override
            public void save(String state) {}
        };
        CoreCredentialBoundary boundary = new CoreCredentialBoundary(unavailable);

        CoreSecurityException failure = assertThrows(
            CoreSecurityException.class,
            boundary::load
        );

        assertEquals(
            "Penyimpanan aman Android tidak tersedia. Perangkat tidak dapat dipasangkan.",
            failure.getMessage()
        );
    }

    @Test
    public void publicCredentialStatusNeverContainsTokenOrNativeEndpoint() {
        CoreIdentityState state = new CoreIdentityState();
        state.deviceId = "11111111-1111-4111-8111-111111111111";
        state.deviceToken = "native-secret";
        state.pairingId = "33333333-3333-4333-8333-333333333333";

        Map<String, Object> status =
            CoreCredentialBoundary.publicStatus("ready", state, null);

        assertEquals("paired", status.get("credential"));
        assertEquals(state.deviceId, status.get("deviceId"));
        assertFalse(status.containsKey("deviceToken"));
        assertFalse(status.containsKey("endpoint"));
        assertFalse(status.toString().contains("native-secret"));
        assertTrue(status.toString().contains(state.deviceId));
    }

    @Test
    public void bootstrapTransportAcceptsExactly3144SkusButOrdinaryRoutesStayBounded()
        throws Exception {
        StringBuilder json = new StringBuilder("{\"serverRevision\":\"1\",\"skus\":[");
        for (int index = 0; index < 3_144; index += 1) {
            if (index > 0) json.append(',');
            json.append("{\"id\":")
                .append(index)
                .append(",\"name\":\"")
                .append("X".repeat(1_015))
                .append("\"}");
        }
        json.append("]}");
        byte[] bytes = json.toString().getBytes(StandardCharsets.UTF_8);
        assertTrue(bytes.length > 3_200_000);
        assertTrue(bytes.length < 3_500_000);

        byte[] accepted = CoreApiClient.readBoundedResponse(
            new ByteArrayInputStream(bytes),
            "/v1/bootstrap"
        );
        assertEquals(bytes.length, accepted.length);

        assertThrows(
            CoreSecurityException.class,
            () -> CoreApiClient.readBoundedResponse(
                new ByteArrayInputStream(bytes),
                "/v1/changes?after=0&limit=500"
            )
        );
    }

    @Test
    public void imageUploadRequestGetsOnlyTheBoundedImageTransferAllowance() {
        String imagePath =
            "/v1/skus/11111111-1111-4111-8111-111111111111/image";
        CoreApiClient.requireRequestSize(2_100_000, imagePath);
        assertThrows(
            CoreSecurityException.class,
            () -> CoreApiClient.requireRequestSize(
                2_100_000,
                "/v1/skus"
            )
        );
        assertThrows(
            CoreSecurityException.class,
            () -> CoreApiClient.requireRequestSize(
                2_100_000,
                "/v1/skus/------------------------------------/image"
            )
        );
        assertThrows(
            CoreSecurityException.class,
            () -> CoreApiClient.requireRequestSize(
                7_100_001,
                imagePath
            )
        );
    }
}
