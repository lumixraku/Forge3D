<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
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
const messageList = ref<HTMLElement | null>(null)

watch(() => props.messages.length, async () => {
  await nextTick()
  messageList.value?.scrollTo({ top: messageList.value.scrollHeight })
}, { immediate: true })

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
  <section class="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[62px_minmax(0,1fr)_auto_auto] overflow-hidden border-r border-line bg-bg-panel transition-colors duration-200">
    <header class="flex items-center justify-between border-b border-line px-[17px]"><div><span class="font-mono text-[9px] font-medium tracking-[.12em] text-text-muted">CANVAS COPILOT</span><b class="mt-1 block text-[11px]">DeepSeek tool-calling agent</b></div><i class="size-[7px] rounded-full bg-acid shadow-[0_0_9px_color-mix(in_srgb,var(--acid)_60%,transparent)]" /></header>
    <div ref="messageList" class="min-w-0 overflow-y-auto px-[17px] pb-7 pt-[22px]">
      <article v-for="message in messages" :key="message.id" class="mb-6 min-w-0 [&>span]:mb-[7px] [&>span]:block [&>span]:font-mono [&>span]:text-[8px] [&>span]:font-semibold [&>span]:tracking-[.12em] [&>span]:text-text-muted [&.assistant>span]:text-acid [&.pending_p]:text-text-muted [&.user]:ml-auto [&.user]:w-[min(100%,360px)] [&.user]:rounded-[14px_14px_3px_14px] [&.user]:border [&.user]:border-line-strong [&.user]:bg-bg-input [&.user]:p-[13px] [&.user]:shadow-sm [&.user>span]:mb-[9px] [&.user>span]:text-right [&.user>span]:text-acid [&.user_p]:text-text-primary" :class="[message.role, { pending: message.pending }]">
        <span>{{ message.role === 'assistant' ? 'FORGE' : 'YOU' }}</span>
        <template v-if="message.role === 'assistant'">
          <div v-if="message.pending" class="grid gap-[5px] text-[13px] text-text-secondary"><b class="text-[13px] text-text-primary">{{ stoppingTurnId === message.turnId ? 'Stopping' : 'Thinking' }}</b><span class="after:content-['...'] after:animate-[thinking-ellipsis_1.1s_steps(4,end)_infinite]">{{ message.progress.at(-1)?.label || 'Preparing canvas agent' }}</span></div>
          <details v-else-if="message.progress?.length" class="thought-process mb-[10px] border-l-2 border-line-strong text-[11px] text-text-muted [&>span]:ml-[17px] [&>span]:mt-[7px] [&>span]:block [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:pl-[9px] [&_summary]:transition-colors [&_summary]:hover:text-text-primary [&_summary_small]:ml-[5px] [&_summary_small]:font-mono [&_summary_small]:text-[9px] [&_summary_small]:text-text-muted"><summary>Thought process <small>Tool activity</small></summary><span v-for="(event, index) in message.progress" :key="`${event.label}-${index}`">{{ event.label }}</span></details>
          <div v-if="message.content" class="message-content text-[13px] leading-[1.55] text-text-secondary [overflow-wrap:anywhere]" v-html="renderAssistantMarkdown(message.content)" />
          <button v-if="message.failed" class="mt-[9px] grid size-7 place-items-center rounded-md border-0 bg-transparent p-0 text-text-muted transition-colors hover:bg-bg-input-hover hover:text-acid focus-visible:bg-bg-input-hover focus-visible:text-acid focus-visible:outline-0 [&_svg]:size-[15px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.8]" type="button" title="重试" aria-label="重试" :disabled="busy" @click="emit('retry', message)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2.05 4.95" /></svg></button>
          <section v-if="message.request" class="mt-[10px] grid gap-[9px] rounded-lg border border-line-strong bg-bg-input p-3">
            <p class="m-0 font-semibold text-text-primary">{{ message.request.prompt }}</p>
            <small class="font-mono text-[9px] font-medium tracking-[.04em] text-text-muted">Select {{ message.request.min === message.request.max ? message.request.min : `${message.request.min}–${message.request.max}` }} option{{ message.request.max === 1 ? '' : 's' }}.</small>
            <div class="grid gap-1.5">
              <button v-for="option in message.request.options" :key="option.id" type="button" class="rounded-md border border-line-strong bg-bg-input-hover px-[10px] py-2 text-left text-xs text-text-secondary hover:border-acid hover:text-text-primary [&.selected]:border-acid [&.selected]:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input-hover))] [&.selected]:text-text-primary" :class="{ selected: optionIds(message).includes(option.id) }" :disabled="Boolean(message.selection) || message.pending || continuingTurnId === message.turnId" @click="emit('toggle-option', { message, optionId: option.id })">{{ option.label }}</button>
            </div>
            <span v-if="message.selection" class="justify-self-start font-mono text-[9px] font-semibold tracking-[.04em] text-acid">Answered</span>
            <button v-else class="justify-self-start rounded-md border-0 bg-acid px-[11px] py-[7px] font-mono text-[9px] font-semibold text-text-inverse" type="button" :disabled="!canContinue(message) || message.pending || continuingTurnId === message.turnId" @click="emit('continue-turn', message)">{{ continuingTurnId === message.turnId ? 'Continuing…' : 'Continue' }}</button>
          </section>
        </template>
        <div v-else class="min-w-0">
          <span v-if="message.attachments?.length" class="inline">
            <a v-for="attachment in message.attachments" :key="attachment.id || attachment.name" class="group relative mr-[3px] mb-[5px] inline-flex h-[25px] min-w-0 max-w-[min(120px,100%)] items-center rounded-lg border border-line-strong bg-bg-input-hover py-0 pl-[3px] pr-2 align-middle leading-none text-text-primary no-underline hover:border-[color-mix(in_srgb,var(--acid)_55%,var(--line-strong))]" :href="isImage(attachment) ? attachment.preview : undefined" :target="isImage(attachment) ? '_blank' : undefined" rel="noreferrer">
              <img v-if="isImage(attachment)" class="mr-[5px] size-[19px] flex-none rounded-[5px] bg-bg-active object-cover" :src="attachment.preview" :alt="attachment.name" />
              <span v-else class="mr-[5px] grid size-[19px] flex-none place-items-center rounded-[5px] bg-bg-active text-acid [&_svg]:size-3 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.6]" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11zM13.5 3.5v4h4M9 12h6M9 16h6" /></svg></span>
              <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold">{{ attachment.name }}</span>
              <img v-if="isImage(attachment)" class="absolute bottom-[calc(100%+10px)] left-0 z-[5] block max-h-[220px] w-[min(260px,60vw)] translate-y-1 rounded-lg border border-line-strong bg-bg-panel object-contain opacity-0 shadow-[0_10px_22px_color-mix(in_srgb,#000_25%,transparent)] transition-[opacity,transform] duration-120 pointer-events-none group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100" :src="attachment.preview" :alt="attachment.name" />
            </a>
          </span>
          <p v-if="userContent(message)" class="m-0 min-w-0 text-[13px] leading-[1.55] text-text-secondary [overflow-wrap:anywhere]">{{ userContent(message) }}</p>
        </div>
      </article>
    </div>
    <p v-if="error" class="mx-[17px] mb-2 mt-0 text-[11px] text-status-failed">{{ error }}</p>
    <form class="mx-3 mb-3 rounded-xl border border-line-strong bg-bg-input p-[10px] transition-[border-color,box-shadow] focus-within:border-[color-mix(in_srgb,var(--acid)_45%,var(--line-strong))] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--acid)_10%,transparent)]" @submit.prevent="emit('send')">
      <EditorContent :editor="editor" />
      <input ref="fileInput" class="hidden" type="file" multiple @change="addFiles" />
      <div class="mt-[5px] flex items-center justify-end gap-[7px] [&_button]:grid [&_button]:size-[30px] [&_button]:place-items-center [&_button]:rounded-full [&_button]:border-0 [&_button]:bg-acid [&_button]:p-0 [&_button]:text-text-inverse [&_button]:transition-[transform,filter,box-shadow] [&_button]:hover:-translate-y-px [&_button]:hover:brightness-108 [&_button]:focus-visible:outline-none [&_button]:focus-visible:shadow-[0_0_0_2px_var(--bg-primary),0_0_0_4px_color-mix(in_srgb,var(--acid)_50%,transparent)] [&_svg]:size-[15px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.8]">
        <button class="!border !border-line-subtle !bg-bg-input-hover !text-text-muted hover:!border-acid hover:!text-acid" type="button" title="Attach files" aria-label="Attach files" @click="fileInput.click()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.6 9.5a2 2 0 0 1-2.8-2.8l8.8-8.8" /></svg></button>
        <div class="flex items-center gap-1.5"><button :class="{ '!border !border-[color-mix(in_srgb,var(--status-failed)_55%,var(--line-strong))] !bg-[color-mix(in_srgb,var(--status-failed)_8%,transparent)] !text-status-failed': runningTurnId }" :type="runningTurnId ? 'button' : 'submit'" :title="runningTurnId ? (stoppingTurnId ? 'Stopping' : 'Stop') : 'Send'" :aria-label="runningTurnId ? (stoppingTurnId ? 'Stopping' : 'Stop') : 'Send'" :disabled="runningTurnId ? Boolean(stoppingTurnId) : busy || !composerHasContent" @click="runningTurnId && emit('stop-turn', runningTurnId)"><svg v-if="runningTurnId" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6-7-1Z" /><path d="m12 13 7-8" /></svg></button></div>
      </div>
    </form>
  </section>
</template>

<style scoped>
:deep(.message-content > :first-child) { margin-top: 0; }
:deep(.message-content > :last-child) { margin-bottom: 0; }
:deep(.message-content p) { margin: 0 0 10px; }
:deep(.message-content h1), :deep(.message-content h2), :deep(.message-content h3) { margin: 16px 0 8px; color: var(--text-primary); font-size: 13px; line-height: 1.35; }
:deep(.message-content ul), :deep(.message-content ol) { margin: 0 0 10px; padding-left: 20px; }
:deep(.message-content li + li) { margin-top: 4px; }
:deep(.message-content a) { color: var(--acid); text-decoration: underline; text-underline-offset: 2px; transition: opacity .15s ease; }
:deep(.message-content a:hover) { opacity: .8; }
:deep(.message-content code) { padding: 1px 4px; border-radius: 3px; background: var(--bg-input-hover); color: var(--text-primary); font: 11px var(--font-mono); }
:deep(.message-content pre) { margin: 0 0 10px; padding: 10px; overflow-x: auto; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg-input); }
:deep(.message-content pre code) { padding: 0; background: transparent; }
:deep(.message-content table) { width: 100%; margin: 0 0 12px; border-collapse: separate; border-spacing: 0; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--bg-input-hover); font-size: 12px; }
:deep(.message-content th), :deep(.message-content td) { padding: 8px 10px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); text-align: left; vertical-align: top; }
:deep(.message-content th) { background: var(--bg-active); color: var(--text-primary); font-weight: 700; }
:deep(.message-content td) { color: var(--text-secondary); }
:deep(.message-content th:last-child), :deep(.message-content td:last-child) { border-right: 0; }
:deep(.message-content tr:last-child td) { border-bottom: 0; }
.thought-process summary::-webkit-details-marker { display: none; }
.thought-process summary::before { display: inline-block; margin-right: 6px; content: '›'; transition: transform .15s ease; }
.thought-process[open] summary::before { transform: rotate(90deg); }
.thought-process > span::before { margin-right: 6px; color: var(--acid); content: '✓'; }
:deep(.composer-editor) { display: block; min-height: 42px; width: 100%; outline: 0; color: var(--text-primary); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; caret-color: var(--text-primary); cursor: text; }
:deep(.composer-editor p) { margin: 0; }
:deep(.composer-editor p.is-editor-empty:first-child::before) { float: left; height: 0; color: var(--text-muted); content: 'Describe a 3D canvas or ask for a change…'; pointer-events: none; }
@keyframes thinking-ellipsis { to { clip-path: inset(0 0 0 0); } }
</style>
