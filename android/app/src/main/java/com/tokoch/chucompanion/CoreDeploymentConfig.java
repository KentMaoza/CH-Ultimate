package com.tokoch.chucompanion;

import android.content.Context;
import java.net.URI;

final class CoreDeploymentConfig {
    final URI endpoint;
    final int caResourceId;

    private CoreDeploymentConfig(URI endpoint, int caResourceId) {
        this.endpoint = endpoint;
        this.caResourceId = caResourceId;
    }

    static CoreDeploymentConfig load(Context context) {
        String packageName = context.getPackageName();
        int endpointResourceId = context
            .getResources()
            .getIdentifier("ch_core_endpoint", "string", packageName);
        int caResourceId = context
            .getResources()
            .getIdentifier("ch_core_ca", "raw", packageName);
        if (endpointResourceId == 0 || caResourceId == 0) return null;
        String endpoint = context.getString(endpointResourceId).trim();
        return new CoreDeploymentConfig(
            CoreEndpointPolicy.requireApproved(endpoint),
            caResourceId
        );
    }
}
