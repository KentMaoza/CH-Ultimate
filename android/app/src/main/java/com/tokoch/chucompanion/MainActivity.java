package com.tokoch.chucompanion;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CoreApiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
