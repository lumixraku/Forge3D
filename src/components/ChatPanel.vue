<script setup lang="ts">
import { ref } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { canContinueSelection, selectedOptionIds } from '../chat-selection'

const props = defineProps<{
  messages: any[]
  editor: any
  busy: boolean
  error: string
  composerHasContent: boolean
  continuingTaskId: string | null
  selectedOptions: Record<string, string[]>
}>()
const emit = defineEmits<{
  send: []
  'attach-files': [files: File[]]
  'toggle-option': [payload: { message: any; optionId: string }]
  'continue-task': [message: any]
}>()
const fileInput = ref<HTMLInputElement | null>(null)

function renderAssistantMarkdown(content: string) {
  return DOMPurify.sanitize(marked.parse(content || '', { async: false, breaks: true, gfm: true, html: false }))
}

function optionIds(message) {
  return selectedOptionIds(message, props.selectedOptions)
}

function canContinue(message) {
  return canContinueSelection(message, props.selectedOptions)
}

function addFiles(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  emit('attach-files', files)
}
</script>

<template>
  <section class="chat-panel bg-bg-panel border-r border-line">
    <header><div><span>WORKFLOW COPILOT</span><b>DeepSeek tool-calling agent</b></div><i /></header>
    <div class="message-list">
      <article v-for="message in messages" :key="message.id" class="message" :class="[message.role, { pending: message.pending }]">
        <span>{{ message.role === 'assistant' ? 'FORGE' : 'YOU' }}</span>
        <template v-if="message.role === 'assistant'">
          <div v-if="message.pending" class="thinking-progress"><b>Thinking</b><span>{{ message.progress.at(-1)?.label || 'Preparing workflow agent' }}</span></div>
          <details v-else-if="message.progress?.length" class="thought-process"><summary>Thought process <small>Tool activity</small></summary><span v-for="(event, index) in message.progress" :key="`${event.label}-${index}`">{{ event.label }}</span></details>
          <div v-if="message.content" class="message-content" v-html="renderAssistantMarkdown(message.content)" />
          <section v-if="message.request" class="user-selection">
            <p>{{ message.request.prompt }}</p>
            <small>Select {{ message.request.min === message.request.max ? message.request.min : `${message.request.min}–${message.request.max}` }} option{{ message.request.max === 1 ? '' : 's' }}.</small>
            <div class="user-selection-options">
              <button v-for="option in message.request.options" :key="option.id" type="button" :class="{ selected: optionIds(message).includes(option.id) }" :disabled="Boolean(message.selection) || message.pending || continuingTaskId === message.taskId" @click="emit('toggle-option', { message, optionId: option.id })">{{ option.label }}</button>
            </div>
            <span v-if="message.selection" class="user-selection-answered">Answered</span>
            <button v-else class="user-selection-submit" type="button" :disabled="!canContinue(message) || message.pending || continuingTaskId === message.taskId" @click="emit('continue-task', message)">{{ continuingTaskId === message.taskId ? 'Continuing…' : 'Continue' }}</button>
          </section>
        </template>
        <p v-else>{{ message.content }}</p>
      </article>
    </div>
    <p v-if="error" class="error-message">{{ error }}</p>
    <form class="composer" @submit.prevent="emit('send')">
      <EditorContent :editor="editor" />
      <input ref="fileInput" class="file-input" type="file" multiple @change="addFiles" />
      <div class="composer-actions"><button class="composer-attach-button" type="button" title="Attach files" @click="fileInput.click()">Attach</button><span>⌘ ENTER TO SEND</span><button :disabled="busy || !composerHasContent">Send ↗</button></div>
    </form>
  </section>
</template>
