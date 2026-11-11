package com.carrental.modules.ai.knowledge;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Shared access to the C2.2 off-topic question set for other chat tests. */
public final class KnowledgeRetrieverTestSupport {
    private KnowledgeRetrieverTestSupport() {}

    public static List<String> offTopic() {
        try (InputStream in = KnowledgeRetrieverTestSupport.class.getClassLoader().getResourceAsStream("ai/retrieval/offtopic.txt")) {
            if (in == null) throw new IllegalStateException("offtopic.txt missing");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().filter(l -> !l.isBlank()).toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
