package com.tokoch.chucompanion;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.net.URL;
import java.security.Principal;
import java.security.cert.Certificate;
import javax.net.ssl.HttpsURLConnection;
import org.junit.Test;

public class CoreApiRedirectPolicyTest {

    @Test
    public void disablesAutomaticRedirectsAndRejectsEveryRedirectStatus()
        throws Exception {
        FakeHttpsURLConnection connection = new FakeHttpsURLConnection();
        assertTrue(connection.getInstanceFollowRedirects());

        CoreApiClient.disableRedirects(connection);

        assertFalse(connection.getInstanceFollowRedirects());
        for (int status = 300; status <= 399; status += 1) {
            int redirectStatus = status;
            assertThrows(
                CoreSecurityException.class,
                () -> CoreApiClient.requireNonRedirectStatus(redirectStatus)
            );
        }
        CoreApiClient.requireNonRedirectStatus(299);
        CoreApiClient.requireNonRedirectStatus(400);
    }

    private static final class FakeHttpsURLConnection
        extends HttpsURLConnection {

        FakeHttpsURLConnection() throws Exception {
            super(new URL("https://192.168.50.14:8443/v1/bootstrap"));
        }

        @Override
        public void disconnect() {}

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public void connect() {}

        @Override
        public String getCipherSuite() {
            return "TLS_AES_128_GCM_SHA256";
        }

        @Override
        public Certificate[] getLocalCertificates() {
            return null;
        }

        @Override
        public Certificate[] getServerCertificates() {
            return null;
        }

        @Override
        public Principal getPeerPrincipal() {
            return null;
        }

        @Override
        public Principal getLocalPrincipal() {
            return null;
        }
    }
}
