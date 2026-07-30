package com.tokoch.chucompanion;

import java.net.URLDecoder;
import java.io.UnsupportedEncodingException;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

final class CoreRequestPolicy {
    private static final String UUID =
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-" +
        "[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
    private static final String SHA256 = "[0-9a-f]{64}";
    private static final Pattern CONTROL_OR_SEPARATOR =
        Pattern.compile("[\\x00-\\x1f\\x7f\\\\#]");
    private static final List<Rule> RULES = List.of(
        new Rule(Set.of("GET"), Pattern.compile("^/v1/bootstrap$")),
        new Rule(
            Set.of("GET"),
            Pattern.compile("^/v1/changes\\?after=(?:0|[1-9]\\d*)&limit=500$")
        ),
        new Rule(Set.of("POST"), Pattern.compile("^/v1/skus$")),
        new Rule(
            Set.of("PATCH"),
            Pattern.compile("^/v1/skus/" + UUID + "$")
        ),
        new Rule(
            Set.of("POST"),
            Pattern.compile("^/v1/skus/" + UUID + "/stock-adjustments$")
        ),
        new Rule(
            Set.of("GET"),
            Pattern.compile("^/v1/images/" + SHA256 + "$")
        ),
        new Rule(Set.of("POST"), Pattern.compile("^/v1/images$")),
        new Rule(
            Set.of("PATCH"),
            Pattern.compile("^/v1/templates/(?:label|invoice)$")
        ),
        new Rule(Set.of("POST"), Pattern.compile("^/v1/notas$")),
        new Rule(
            Set.of("POST"),
            Pattern.compile("^/v1/notas/" + UUID + "/pages$")
        ),
        new Rule(
            Set.of("POST"),
            Pattern.compile(
                "^/v1/notas/" + UUID + "/pages/" + UUID + "/(?:cancel|restore)$"
            )
        ),
        new Rule(
            Set.of("PATCH"),
            Pattern.compile("^/v1/notas/" + UUID + "/header$")
        ),
        new Rule(
            Set.of("PATCH", "DELETE"),
            Pattern.compile(
                "^/v1/notas/" +
                UUID +
                "/pages/" +
                UUID +
                "/lines/" +
                UUID +
                "$"
            )
        ),
        new Rule(
            Set.of("POST"),
            Pattern.compile(
                "^/v1/notas/" +
                UUID +
                "/(?:complete|reopen|cancel|restore)$"
            )
        ),
        new Rule(
            Set.of("POST"),
            Pattern.compile("^/v1/conflicts/" + UUID + "/resolve$")
        )
    );

    private CoreRequestPolicy() {}

    static void requireApproved(
        String method,
        String path,
        boolean hasBody,
        boolean hasIdempotencyKey
    ) {
        if (
            !Set.of("GET", "POST", "PATCH", "DELETE").contains(method) ||
            path == null ||
            !path.startsWith("/v1/") ||
            path.startsWith("//") ||
            CONTROL_OR_SEPARATOR.matcher(path).find() ||
            ("GET".equals(method) && (hasBody || hasIdempotencyKey))
        ) {
            throw invalidRequest();
        }
        String pathOnly = path.split("\\?", 2)[0];
        try {
            String decoded = URLDecoder.decode(
                pathOnly,
                "UTF-8"
            );
            if (decoded.contains("..") || decoded.contains("//")) {
                throw invalidRequest();
            }
        } catch (
            IllegalArgumentException |
            UnsupportedEncodingException error
        ) {
            throw invalidRequest();
        }
        boolean allowed = RULES
            .stream()
            .anyMatch(rule ->
                rule.methods.contains(method) &&
                rule.path.matcher(path).matches()
            );
        if (!allowed) throw invalidRequest();
    }

    private static CoreSecurityException invalidRequest() {
        return new CoreSecurityException(
            "Permintaan CH Core tidak valid."
        );
    }

    private static final class Rule {
        private final Set<String> methods;
        private final Pattern path;

        private Rule(Set<String> methods, Pattern path) {
            this.methods = methods;
            this.path = path;
        }
    }
}
