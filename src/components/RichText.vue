<script setup lang="ts">
import type { RichText } from "@/lib/notion";

defineProps<{ texts: RichText[] }>();

function annotationClasses(annotations: RichText["annotations"]): string[] {
  const cls: string[] = [];
  if (annotations.bold) cls.push("nr-bold");
  if (annotations.italic) cls.push("nr-italic");
  if (annotations.strikethrough) cls.push("nr-strikethrough");
  if (annotations.underline) cls.push("nr-underline");
  if (annotations.code) cls.push("nr-inline-code");
  if (annotations.color && annotations.color !== "default") {
    cls.push(`nr-color-${annotations.color}`);
  }
  return cls;
}

function splitByNewline(text: string): string[] {
  return text.split("\n");
}
</script>

<template>
  <template v-for="(t, i) in texts" :key="i">
    <!-- mention (with link) -->
    <template v-if="t.type === 'mention' && t.href">
      <a
        :href="t.href"
        class="nr-mention nr-mention-link"
        :class="i === 0 ? 'nr-mention-first' : undefined"
        :target="t.href.startsWith('/') ? undefined : '_blank'"
        :rel="t.href.startsWith('/') ? undefined : 'noopener noreferrer'"
      >
        <span v-if="(t as any)._icon" class="nr-mention-icon">{{ (t as any)._icon }}</span>
        <img v-else-if="(t as any)._faviconUrl" :src="(t as any)._faviconUrl" class="nr-mention-favicon" width="18" height="18" />
        <i v-else :class="t.href.startsWith('/') ? 'bi bi-file-earmark-text' : 'bi bi-box-arrow-up-right'" class="nr-mention-bi"></i>
        <template v-for="(line, j) in splitByNewline(t.plain_text)" :key="j">
          <br v-if="j > 0" />{{ line }}
        </template>
      </a>
    </template>

    <!-- mention (no link) -->
    <template v-else-if="t.type === 'mention'">
      <span class="nr-mention">
        <template v-for="(line, j) in splitByNewline(t.plain_text)" :key="j">
          <br v-if="j > 0" />{{ line }}
        </template>
      </span>
    </template>

    <!-- equation -->
    <template v-else-if="t.type === 'equation'">
      <code class="nr-equation">
        <template v-for="(line, j) in splitByNewline(t.plain_text)" :key="j">
          <br v-if="j > 0" />{{ line }}
        </template>
      </code>
    </template>

    <!-- text (default) -->
    <template v-else>
      <!-- リンク付き -->
      <a
        v-if="t.href"
        :href="t.href"
        :class="annotationClasses(t.annotations)"
        class="nr-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        <template v-for="(line, j) in splitByNewline(t.plain_text)" :key="j">
          <br v-if="j > 0" />{{ line }}
        </template>
      </a>
      <!-- プレーンテキスト or アノテーション付き -->
      <span
        v-else
        :class="annotationClasses(t.annotations)"
      >
        <template v-for="(line, j) in splitByNewline(t.plain_text)" :key="j">
          <br v-if="j > 0" />{{ line }}
        </template>
      </span>
    </template>
  </template>
</template>

<style scoped>
.nr-bold {
  font-weight: 700;
}
.nr-italic {
  font-style: italic;
}
.nr-strikethrough {
  text-decoration: line-through;
}
.nr-underline {
  text-decoration: underline;
}
.nr-inline-code {
  font-family: var(--f-code);
  font-size: 0.85em;
  background: var(--c-code-bg);
  padding: 0.125em 0.35em;
  border-radius: 3px;
  color: #d63384;
}
.nr-link {
  color: var(--c-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.nr-mention {
  padding: 0.1em 0.2em;
  border-radius: 0.2em;
}
.nr-mention-first {
  margin-left: -0.3em;
}
.nr-mention-link {
  color: var(--c-accent);
  text-decoration: underline;
  text-decoration-color: var(--c-text-sub);
  text-underline-offset: 0.25em;
}
.nr-mention-link:hover {
  color: var(--c-accent);
  background-color: var(--c-callout-bg);
  text-decoration: none;
}
.nr-mention-link:active {
  background-color: var(--c-accent-soft);
  text-decoration: none;
}
.nr-mention-icon {
  font-size: 1.1em;
  margin-right: 0.2em;
  vertical-align: -0.1em;
}
.nr-mention-favicon {
  margin-right: 0.3em;
  vertical-align: -0.2em;
}
.nr-mention-bi {
  font-size: 1em;
  margin-right: 0.25em;
  margin-left: 0.05em;
  color: var(--bs-body-color);
}
.nr-equation {
  font-family: var(--f-code);
  font-style: italic;
}

/* Notion text colors */
.nr-color-gray { color: #9b9a97; }
.nr-color-brown { color: #64473a; }
.nr-color-orange { color: #d9730d; }
.nr-color-yellow { color: #dfab01; }
.nr-color-green { color: #0f7b6c; }
.nr-color-blue { color: #0b6e99; }
.nr-color-purple { color: #6940a5; }
.nr-color-pink { color: #ad1a72; }
.nr-color-red { color: #e03e3e; }

.nr-color-gray_background { background: #ebeced; }
.nr-color-brown_background { background: #e9e5e3; }
.nr-color-orange_background { background: #faebdd; }
.nr-color-yellow_background { background: #fbf3db; }
.nr-color-green_background { background: #ddedea; }
.nr-color-blue_background { background: #ddebf1; }
.nr-color-purple_background { background: #eae4f2; }
.nr-color-pink_background { background: #f4dfeb; }
.nr-color-red_background { background: #fbe4e4; }
</style>
