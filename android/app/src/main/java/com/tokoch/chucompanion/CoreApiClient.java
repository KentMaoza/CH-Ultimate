package com.tokoch.chucompanion;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Locale;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

final class CoreApiClient {
    private static final int TIMEOUT_MS = 8_000;
    private static final int MAX_RESPONSE_BYTES = 2_000_000;
    private static final int MAX_BOOTSTRAP_RESPONSE_BYTES = 5_000_000;
    private static final int MAX_IMAGE_RESPONSE_BYTES = 7_100_000;
    private static final int MAX_REQUEST_BYTES = 1_000_000;
    private static final int MAX_IMAGE_REQUEST_BYTES = 7_100_000;
    private static final String SKU_IMAGE_PATH =
        "^/v1/skus/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-" +
        "[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-" +
        "[0-9a-fA-F]{12}/image$";
    private final Context context;
    private final CoreDeploymentConfig config;

    CoreApiClient(Context context, CoreDeploymentConfig config) {
        this.context = context.getApplicationContext();
        this.config = config;
    }

    Response send(
        String method,
        String path,
        Object body,
        String idempotencyKey,
        String authorization
    ) {
        HttpsURLConnection connection = null;
        try {
            URL url = config.endpoint.resolve(path).toURL();
            connection = (HttpsURLConnection) url.openConnection();
            disableRedirects(connection);
            connection.setSSLSocketFactory(createSslContext().getSocketFactory());
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (authorization != null) {
                connection.setRequestProperty(
                    "Authorization",
                    authorization
                );
            }
            if (idempotencyKey != null) {
                connection.setRequestProperty(
                    "Idempotency-Key",
                    idempotencyKey
                );
            }
            if (body != null && body != JSONObject.NULL) {
                byte[] encoded = body
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
                requireRequestSize(encoded.length, path);
                connection.setDoOutput(true);
                connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
                );
                connection.setFixedLengthStreamingMode(encoded.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(encoded);
                }
            }
            int status = connection.getResponseCode();
            requireNonRedirectStatus(status);
            InputStream stream =
                status >= 400
                    ? connection.getErrorStream()
                    : connection.getInputStream();
            Object responseBody = readJson(
                stream,
                connection.getContentType(),
                path
            );
            return new Response(status, responseBody);
        } catch (CoreSecurityException error) {
            throw error;
        } catch (Exception error) {
            throw new CoreSecurityException(
                "CH Core tidak dapat dihubungi.",
                error
            );
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static void disableRedirects(HttpsURLConnection connection) {
        connection.setInstanceFollowRedirects(false);
    }

    static void requireNonRedirectStatus(int status) {
        if (status >= 300 && status <= 399) {
            throw new CoreSecurityException(
                "Respons CH Core tidak valid."
            );
        }
    }

    static void requireRequestSize(int byteSize, String path) {
        int maximum =
            path != null &&
            path.matches(SKU_IMAGE_PATH)
                ? MAX_IMAGE_REQUEST_BYTES
                : MAX_REQUEST_BYTES;
        if (byteSize > maximum) {
            throw new CoreSecurityException(
                "Permintaan CH Core terlalu besar."
            );
        }
    }

    private SSLContext createSslContext() throws Exception {
        CertificateFactory factory = CertificateFactory.getInstance(
            "X.509"
        );
        Certificate privateCa;
        try (
            InputStream input = context
                .getResources()
                .openRawResource(config.caResourceId)
        ) {
            privateCa = factory.generateCertificate(input);
        }
        KeyStore trustStore = KeyStore.getInstance(
            KeyStore.getDefaultType()
        );
        trustStore.load(null, null);
        trustStore.setCertificateEntry("ch-core-private-ca", privateCa);
        TrustManagerFactory trustManagers =
            TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
            );
        trustManagers.init(trustStore);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, trustManagers.getTrustManagers(), null);
        return context;
    }

    static Object readJson(
        InputStream input,
        String contentType,
        String path
    ) throws Exception {
        if (input == null) return JSONObject.NULL;
        if (
            contentType == null ||
            !contentType
                .toLowerCase(Locale.ROOT)
                .startsWith("application/json")
        ) {
            throw new CoreSecurityException(
                "Respons CH Core tidak valid."
            );
        }
        byte[] bytes = readBoundedResponse(input, path);
        if (bytes.length == 0) return JSONObject.NULL;
        Object parsed = new JSONTokener(
            new String(bytes, StandardCharsets.UTF_8)
        ).nextValue();
        if (
            !(parsed instanceof JSONObject) &&
            !(parsed instanceof JSONArray)
        ) {
            throw new CoreSecurityException(
                "Respons CH Core tidak valid."
            );
        }
        return parsed;
    }

    static byte[] readBoundedResponse(
        InputStream input,
        String path
    ) throws Exception {
        if (input == null) return new byte[0];
        int maximumBytes = maximumResponseBytes(path);
        try (
            InputStream stream = input;
            ByteArrayOutputStream output = new ByteArrayOutputStream()
        ) {
            byte[] buffer = new byte[8_192];
            int count;
            int total = 0;
            while ((count = stream.read(buffer)) >= 0) {
                total += count;
                if (total > maximumBytes) {
                    throw new CoreSecurityException(
                        "Respons CH Core tidak valid."
                    );
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private static int maximumResponseBytes(String path) {
        if ("/v1/bootstrap".equals(path)) {
            return MAX_BOOTSTRAP_RESPONSE_BYTES;
        }
        if (path != null && path.matches("^/v1/images/[0-9a-f]{64}$")) {
            return MAX_IMAGE_RESPONSE_BYTES;
        }
        return MAX_RESPONSE_BYTES;
    }

    static final class Response {
        final int status;
        final Object body;

        Response(int status, Object body) {
            this.status = status;
            this.body = body;
        }
    }
}
