package com.tokoch.chucompanion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class CoreAndroidSecureStateBackend
    implements CoreSecureStateBackend {
    private static final String KEY_ALIAS =
        "ch_ultimate_core_device_state_v1";
    private static final String PREFERENCES =
        "ch_ultimate_core_secure_state";
    private static final String ENCRYPTED_STATE = "encrypted_state";
    private static final int GCM_TAG_BITS = 128;

    private final SharedPreferences preferences;

    CoreAndroidSecureStateBackend(Context context) {
        preferences = context.getSharedPreferences(
            PREFERENCES,
            Context.MODE_PRIVATE
        );
    }

    @Override
    public boolean isAvailable() {
        try {
            getOrCreateKey();
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    @Override
    public String load() {
        String encoded = preferences.getString(ENCRYPTED_STATE, null);
        if (encoded == null) return null;
        try {
            byte[] packed = Base64.decode(encoded, Base64.NO_WRAP);
            if (packed.length <= 12) throw new IllegalStateException();
            byte[] iv = new byte[12];
            byte[] encrypted = new byte[packed.length - iv.length];
            System.arraycopy(packed, 0, iv, 0, iv.length);
            System.arraycopy(
                packed,
                iv.length,
                encrypted,
                0,
                encrypted.length
            );
            Cipher cipher = Cipher.getInstance(
                "AES/GCM/NoPadding"
            );
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(GCM_TAG_BITS, iv)
            );
            return new String(
                cipher.doFinal(encrypted),
                StandardCharsets.UTF_8
            );
        } catch (Exception error) {
            throw new CoreSecurityException(
                CoreCredentialBoundary.SECURE_STORAGE_UNAVAILABLE,
                error
            );
        }
    }

    @Override
    public void save(String state) {
        try {
            Cipher cipher = Cipher.getInstance(
                "AES/GCM/NoPadding"
            );
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(
                state.getBytes(StandardCharsets.UTF_8)
            );
            byte[] iv = cipher.getIV();
            byte[] packed = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(
                encrypted,
                0,
                packed,
                iv.length,
                encrypted.length
            );
            if (
                !preferences
                    .edit()
                    .putString(
                        ENCRYPTED_STATE,
                        Base64.encodeToString(packed, Base64.NO_WRAP)
                    )
                    .commit()
            ) {
                throw new IllegalStateException();
            }
        } catch (Exception error) {
            throw new CoreSecurityException(
                CoreCredentialBoundary.SECURE_STORAGE_UNAVAILABLE,
                error
            );
        }
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        );
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT |
                KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(
                    KeyProperties.ENCRYPTION_PADDING_NONE
                )
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }
}
