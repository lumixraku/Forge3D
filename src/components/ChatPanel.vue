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
  continuingTurnId: string | null
  runningTurnId: string | null
  stoppingTurnId: string | null
  selectedOptions: Record<string, string[]>
}>()
const emit = defineEmits<{
  send: []
  'attach-files': [files: File[]]
  'toggle-option': [payload: { message: any; optionId: string }]
  'continue-turn': [message: any]
  'stop-turn': [turnId: string]
  retry: [message: any]
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

function isImage(attachment) {
  return attachment?.type?.startsWith('image/') && attachment.preview
}

function userContent(message) {
  return (message.content || '').replace(/\[Attachment: [^\]]+\]\s*/g, '').trim()
}
</script>

<template>
  <section class="chat-panel bg-bg-panel border-r border-line">
    <header><div><span>CANVAS COPILOT</span><b>DeepSeek tool-calling agent</b></div><i /></header>
    <div class="message-list">
      <article v-for="message in messages" :key="message.id" class="message" :class="[message.role, { pending: message.pending }]">
        <span>{{ message.role === 'assistant' ? 'FORGE' : 'YOU' }}</span>
        <template v-if="message.role === 'assistant'">
          <div v-if="message.pending" class="thinking-progress"><b>{{ stoppingTurnId === message.turnId ? 'Stopping' : 'Thinking' }}</b><span>{{ message.progress.at(-1)?.label || 'Preparing canvas agent' }}</span></div>
          <details v-else-if="message.progress?.length" class="thought-process"><summary>Thought process <small>Tool activity</small></summary><span v-for="(event, index) in message.progress" :key="`${event.label}-${index}`">{{ event.label }}</span></details>
          <div v-if="message.content" class="message-content" v-html="renderAssistantMarkdown(message.content)" />
          <button v-if="message.failed" class="message-retry" type="button" title="重试" aria-label="重试" :disabled="busy" @click="emit('retry', message)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2.05 4.95" /></svg></button>
          <section v-if="message.request" class="user-selection">
            <p>{{ message.request.prompt }}</p>
            <small>Select {{ message.request.min === message.request.max ? message.request.min : `${message.request.min}–${message.request.max}` }} option{{ message.request.max === 1 ? '' : 's' }}.</small>
            <div class="user-selection-options">
              <button v-for="option in message.request.options" :key="option.id" type="button" :class="{ selected: optionIds(message).includes(option.id) }" :disabled="Boolean(message.selection) || message.pending || continuingTurnId === message.turnId" @click="emit('toggle-option', { message, optionId: option.id })">{{ option.label }}</button>
            </div>
            <span v-if="message.selection" class="user-selection-answered">Answered</span>
            <button v-else class="user-selection-submit" type="button" :disabled="!canContinue(message) || message.pending || continuingTurnId === message.turnId" @click="emit('continue-turn', message)">{{ continuingTurnId === message.turnId ? 'Continuing…' : 'Continue' }}</button>
          </section>
        </template>
        <div v-else class="user-message-body">
          <span v-if="message.attachments?.length" class="message-attachments">
            <a v-for="attachment in message.attachments" :key="attachment.id || attachment.name" class="message-attachment" :href="isImage(attachment) ? attachment.preview : undefined" :target="isImage(attachment) ? '_blank' : undefined" rel="noreferrer">
              <img v-if="isImage(attachment)" :src="attachment.preview" :alt="attachment.name" />
              <span v-else class="message-attachment-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11zM13.5 3.5v4h4M9 12h6M9 16h6" /></svg></span>
              <span class="message-attachment-name">{{ attachment.name }}</span>
              <img v-if="isImage(attachment)" class="message-attachment-preview" :src="attachment.preview" :alt="attachment.name" />
            </a>
          </span>
          <p v-if="userContent(message)">{{ userContent(message) }}</p>
        </div>
      </article>
    </div>
    <p v-if="error" class="error-message">{{ error }}</p>
    <form class="composer" @submit.prevent="emit('send')">
      <EditorContent :editor="editor" />
      <input ref="fileInput" class="file-input" type="file" multiple @change="addFiles" />
      <div class="composer-actions">
        <button class="composer-attach-button" type="button" title="Attach files" aria-label="Attach files" @click="fileInput.click()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.6 9.5a2 2 0 0 1-2.8-2.8l8.8-8.8" /></svg></button>
        <div class="composer-run-actions"><button :class="{ 'composer-stop-button': runningTurnId }" :type="runningTurnId ? 'button' : 'submit'" :title="runningTurnId ? (stoppingTurnId ? 'Stopping' : 'Stop') : 'Send'" :aria-label="runningTurnId ? (stoppingTurnId ? 'Stopping' : 'Stop') : 'Send'" :disabled="runningTurnId ? Boolean(stoppingTurnId) : busy || !composerHasContent" @click="runningTurnId && emit('stop-turn', runningTurnId)"><svg v-if="runningTurnId" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6-7-1Z" /><path d="m12 13 7-8" /></svg></button></div>
      </div>
    </form>
  </section>
</template>
