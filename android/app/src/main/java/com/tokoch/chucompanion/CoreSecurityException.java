package com.tokoch.chucompanion;

final class CoreSecurityException extends RuntimeException {
    CoreSecurityException(String message) {
        super(message);
    }

    CoreSecurityException(String message, Throwable cause) {
        super(message, cause);
    }
}
