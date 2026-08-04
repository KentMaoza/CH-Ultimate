package com.tokoch.chucompanion;

interface CoreSecureStateBackend {
    boolean isAvailable();
    String load();
    void save(String state);
}
