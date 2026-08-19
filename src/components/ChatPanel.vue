<script setup lang="ts">
import { bizClass } from '../class-prefix'
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
  <section class="forge:grid forge:min-h-0 forge:min-w-0 forge:grid-cols-[minmax(0,1fr)] forge:grid-rows-[62px_minmax(0,1fr)_auto_auto] forge:overflow-hidden forge:border-r forge:border-line forge:bg-bg-panel forge:transition-colors forge:duration-200">
    <header class="forge:flex forge:items-center forge:justify-between forge:border-b forge:border-line forge:px-[17px]"><div><span class="forge:font-mono forge:text-[9px] forge:font-medium forge:tracking-[.12em] forge:text-text-muted">CANVAS COPILOT</span><b class="forge:mt-1 forge:block forge:text-[11px]">DeepSeek tool-calling agent</b></div><i class="forge:size-[7px] forge:rounded-full forge:bg-acid forge:shadow-[0_0_9px_color-mix(in_srgb,var(--acid)_60%,transparent)]" /></header>
    <div ref="messageList" class="forge:min-w-0 forge:overflow-y-auto forge:px-[17px] forge:pb-7 forge:pt-[22px]">
      <article v-for="message in messages" :key="message.id" class="forge:mb-6 forge:min-w-0 forge:[&>span]:mb-[7px] forge:[&>span]:block forge:[&>span]:font-mono forge:[&>span]:text-[8px] forge:[&>span]:font-semibold forge:[&>span]:tracking-[.12em] forge:[&>span]:text-text-muted forge:[&.forge3d-assistant>span]:text-acid forge:[&.forge3d-pending_p]:text-text-muted forge:[&.forge3d-user]:ml-auto forge:[&.forge3d-user]:w-[min(100%,360px)] forge:[&.forge3d-user]:rounded-[14px_14px_3px_14px] forge:[&.forge3d-user]:border forge:[&.forge3d-user]:border-line-strong forge:[&.forge3d-user]:bg-bg-input forge:[&.forge3d-user]:p-[13px] forge:[&.forge3d-user]:shadow-sm forge:[&.forge3d-user>span]:mb-[9px] forge:[&.forge3d-user>span]:text-right forge:[&.forge3d-user>span]:text-acid forge:[&.forge3d-user_p]:text-text-primary" :class="[bizClass(message.role), { 'forge3d-pending': message.pending }]">
        <span>{{ message.role === 'assistant' ? 'FORGE' : 'YOU' }}</span>
        <template v-if="message.role === 'assistant'">
          <div v-if="message.pending" class="forge:grid forge:gap-[5px] forge:text-[13px] forge:text-text-secondary">
            <div class="forge:flex forge:items-center forge:justify-between forge:gap-3"><b class="forge:text-[13px] forge:text-text-primary">{{ message.taskTitle || (stoppingTurnId === message.turnId ? 'Stopping' : 'Working') }}</b><button class="forge:rounded forge:border forge:border-line-strong forge:bg-transparent forge:px-2 forge:py-1 forge:font-mono forge:text-[8px] forge:text-text-muted forge:hover:border-status-failed forge:hover:text-status-failed" type="button" :disabled="stoppingTurnId === message.turnId" @click="emit('stop-turn', message.turnId)">{{ stoppingTurnId === message.turnId ? 'STOPPING' : 'STOP' }}</button></div>
            <span class="forge:after:content-['...'] forge:after:animate-[thinking-ellipsis_1.1s_steps(4,end)_infinite]">{{ message.progress.at(-1)?.label || `Preparing ${message.taskKind || 'agent'} worker` }}</span>
          </div>
          <details v-else-if="message.progress?.length" class="forge3d-thought-process forge:mb-[10px] forge:border-l-2 forge:border-line-strong forge:text-[11px] forge:text-text-muted forge:[&>span]:ml-[17px] forge:[&>span]:mt-[7px] forge:[&>span]:block forge:[&_summary]:cursor-pointer forge:[&_summary]:list-none forge:[&_summary]:pl-[9px] forge:[&_summary]:transition-colors forge:[&_summary]:hover:text-text-primary forge:[&_summary_small]:ml-[5px] forge:[&_summary_small]:font-mono forge:[&_summary_small]:text-[9px] forge:[&_summary_small]:text-text-muted"><summary>Thought process <small>Tool activity</small></summary><span v-for="(event, index) in message.progress" :key="`${event.label}-${index}`">{{ event.label }}</span></details>
          <div v-if="message.content" class="forge3d-message-content forge:text-[13px] forge:leading-[1.55] forge:text-text-secondary forge:[overflow-wrap:anywhere]" v-html="renderAssistantMarkdown(message.content)" />
          <button v-if="message.failed" class="forge:mt-[9px] forge:grid forge:size-7 forge:place-items-center forge:rounded-md forge:border-0 forge:bg-transparent forge:p-0 forge:text-text-muted forge:transition-colors forge:hover:bg-bg-input-hover forge:hover:text-acid forge:focus-visible:bg-bg-input-hover forge:focus-visible:text-acid forge:focus-visible:outline-0 forge:[&_svg]:size-[15px] forge:[&_svg]:fill-none forge:[&_svg]:stroke-current forge:[&_svg]:stroke-[1.8]" type="button" title="重试" aria-label="重试" :disabled="busy" @click="emit('retry', message)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2.05 4.95" /></svg></button>
          <section v-if="message.request" class="forge:mt-[10px] forge:grid forge:gap-[9px] forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input forge:p-3">
            <p class="forge:m-0 forge:font-semibold forge:text-text-primary">{{ message.request.prompt }}</p>
            <small class="forge:font-mono forge:text-[9px] forge:font-medium forge:tracking-[.04em] forge:text-text-muted">Select {{ message.request.min === message.request.max ? message.request.min : `${message.request.min}–${message.request.max}` }} option{{ message.request.max === 1 ? '' : 's' }}.</small>
            <div class="forge:grid forge:gap-1.5">
              <button v-for="option in message.request.options" :key="option.id" type="button" class="forge:rounded-md forge:border forge:border-line-strong forge:bg-bg-input-hover forge:px-[10px] forge:py-2 forge:text-left forge:text-xs forge:text-text-secondary forge:hover:border-acid forge:hover:text-text-primary forge:[&.forge3d-selected]:border-acid forge:[&.forge3d-selected]:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input-hover))] forge:[&.forge3d-selected]:text-text-primary" :class="{ 'forge3d-selected': optionIds(message).includes(option.id) }" :disabled="Boolean(message.selection) || message.pending || continuingTurnId === message.turnId" @click="emit('toggle-option', { message, optionId: option.id })">{{ option.label }}</button>
            </div>
            <span v-if="message.selection" class="forge:justify-self-start forge:font-mono forge:text-[9px] forge:font-semibold forge:tracking-[.04em] forge:text-acid">Answered</span>
            <button v-else class="forge:justify-self-start forge:rounded-md forge:border-0 forge:bg-acid forge:px-[11px] forge:py-[7px] forge:font-mono forge:text-[9px] forge:font-semibold forge:text-text-inverse" type="button" :disabled="!canContinue(message) || message.pending || continuingTurnId === message.turnId" @click="emit('continue-turn', message)">{{ continuingTurnId === message.turnId ? 'Continuing…' : 'Continue' }}</button>
          </section>
        </template>
        <div v-else class="forge:min-w-0">
          <span v-if="message.attachments?.length" class="forge:inline">
            <a v-for="attachment in message.attachments" :key="attachment.id || attachment.name" class="forge:group forge:relative forge:mr-[3px] forge:mb-[5px] forge:inline-flex forge:h-[25px] forge:min-w-0 forge:max-w-[min(120px,100%)] forge:items-center forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-input-hover forge:py-0 forge:pl-[3px] forge:pr-2 forge:align-middle forge:leading-none forge:text-text-primary forge:no-underline forge:hover:border-[color-mix(in_srgb,var(--acid)_55%,var(--line-strong))]" :href="isImage(attachment) ? attachment.preview : undefined" :target="isImage(attachment) ? '_blank' : undefined" rel="noreferrer">
              <img v-if="isImage(attachment)" class="forge:mr-[5px] forge:size-[19px] forge:flex-none forge:rounded-[5px] forge:bg-bg-active forge:object-cover" :src="attachment.preview" :alt="attachment.name" />
              <span v-else class="forge:mr-[5px] forge:grid forge:size-[19px] forge:flex-none forge:place-items-center forge:rounded-[5px] forge:bg-bg-active forge:text-acid forge:[&_svg]:size-3 forge:[&_svg]:fill-none forge:[&_svg]:stroke-current forge:[&_svg]:stroke-[1.6]" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11zM13.5 3.5v4h4M9 12h6M9 16h6" /></svg></span>
              <span class="forge:min-w-0 forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:text-[11px] forge:font-semibold">{{ attachment.name }}</span>
              <img v-if="isImage(attachment)" class="forge:absolute forge:bottom-[calc(100%+10px)] forge:left-0 forge:z-[5] forge:block forge:max-h-[220px] forge:w-[min(260px,60vw)] forge:translate-y-1 forge:rounded-lg forge:border forge:border-line-strong forge:bg-bg-panel forge:object-contain forge:opacity-0 forge:shadow-[0_10px_22px_color-mix(in_srgb,#000_25%,transparent)] forge:transition-[opacity,transform] forge:duration-120 forge:pointer-events-none forge:group-hover:translate-y-0 forge:group-hover:opacity-100 forge:group-focus-visible:translate-y-0 forge:group-focus-visible:opacity-100" :src="attachment.preview" :alt="attachment.name" />
            </a>
          </span>
          <p v-if="userContent(message)" class="forge:m-0 forge:min-w-0 forge:text-[13px] forge:leading-[1.55] forge:text-text-secondary forge:[overflow-wrap:anywhere]">{{ userContent(message) }}</p>
        </div>
      </article>
    </div>
    <p v-if="error" class="forge:mx-[17px] forge:mb-2 forge:mt-0 forge:text-[11px] forge:text-status-failed">{{ error }}</p>
    <form class="forge:mx-3 forge:mb-3 forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-[10px] forge:transition-[border-color,box-shadow] forge:focus-within:border-[color-mix(in_srgb,var(--acid)_45%,var(--line-strong))] forge:focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--acid)_10%,transparent)]" @submit.prevent="emit('send')">
      <EditorContent :editor="editor" />
      <input ref="fileInput" class="forge:hidden" type="file" multiple @change="addFiles" />
      <div class="forge:mt-[5px] forge:flex forge:items-center forge:justify-end forge:gap-[7px] forge:[&_button]:grid forge:[&_button]:size-[30px] forge:[&_button]:place-items-center forge:[&_button]:rounded-full forge:[&_button]:border-0 forge:[&_button]:bg-acid forge:[&_button]:p-0 forge:[&_button]:text-text-inverse forge:[&_button]:transition-[transform,filter,box-shadow] forge:[&_button]:hover:-translate-y-px forge:[&_button]:hover:brightness-108 forge:[&_button]:focus-visible:outline-none forge:[&_button]:focus-visible:shadow-[0_0_0_2px_var(--bg-primary),0_0_0_4px_color-mix(in_srgb,var(--acid)_50%,transparent)] forge:[&_svg]:size-[15px] forge:[&_svg]:fill-none forge:[&_svg]:stroke-current forge:[&_svg]:stroke-[1.8]">
        <button class="forge:!border forge:!border-line-subtle forge:!bg-bg-input-hover forge:!text-text-muted forge:hover:!border-acid forge:hover:!text-acid" type="button" title="Attach files" aria-label="Attach files" @click="fileInput.click()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.5-9.5a4 4 0 0 1 5.7 5.7l-9.6 9.5a2 2 0 0 1-2.8-2.8l8.8-8.8" /></svg></button>
        <div class="forge:flex forge:items-center forge:gap-1.5"><button :class="{ 'forge:!border forge:!border-[color-mix(in_srgb,var(--status-failed)_55%,var(--line-strong))] forge:!bg-[color-mix(in_srgb,var(--status-failed)_8%,transparent)] forge:!text-status-failed': runningTurnId }" :type="runningTurnId ? 'button' : 'submit'" :title="runningTurnId ? (stoppingTurnId ? 'Stopping' : 'Stop') : 'Send'" :aria-label="runningTurnId ? (stoppingTurnId ? 'Stopping' : 'Stop') : 'Send'" :disabled="runningTurnId ? Boolean(stoppingTurnId) : busy || !composerHasContent" @click="runningTurnId && emit('stop-turn', runningTurnId)"><svg v-if="runningTurnId" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6-7-1Z" /><path d="m12 13 7-8" /></svg></button></div>
      </div>
    </form>
  </section>
</template>

<style scoped>
:deep(.forge3d-message-content > :first-child) { margin-top: 0; }
:deep(.forge3d-message-content > :last-child) { margin-bottom: 0; }
:deep(.forge3d-message-content p) { margin: 0 0 10px; }
:deep(.forge3d-message-content h1), :deep(.forge3d-message-content h2), :deep(.forge3d-message-content h3) { margin: 16px 0 8px; color: var(--text-primary); font-size: 13px; line-height: 1.35; }
:deep(.forge3d-message-content ul), :deep(.forge3d-message-content ol) { margin: 0 0 10px; padding-left: 20px; }
:deep(.forge3d-message-content li + li) { margin-top: 4px; }
:deep(.forge3d-message-content a) { color: var(--acid); text-decoration: underline; text-underline-offset: 2px; transition: opacity .15s ease; }
:deep(.forge3d-message-content a:hover) { opacity: .8; }
:deep(.forge3d-message-content code) { padding: 1px 4px; border-radius: 3px; background: var(--bg-input-hover); color: var(--text-primary); font: 11px var(--font-mono); }
:deep(.forge3d-message-content pre) { margin: 0 0 10px; padding: 10px; overflow-x: auto; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg-input); }
:deep(.forge3d-message-content pre code) { padding: 0; background: transparent; }
:deep(.forge3d-message-content table) { width: 100%; margin: 0 0 12px; border-collapse: separate; border-spacing: 0; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--bg-input-hover); font-size: 12px; }
:deep(.forge3d-message-content th), :deep(.forge3d-message-content td) { padding: 8px 10px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); text-align: left; vertical-align: top; }
:deep(.forge3d-message-content th) { background: var(--bg-active); color: var(--text-primary); font-weight: 700; }
:deep(.forge3d-message-content td) { color: var(--text-secondary); }
:deep(.forge3d-message-content th:last-child), :deep(.forge3d-message-content td:last-child) { border-right: 0; }
:deep(.forge3d-message-content tr:last-child td) { border-bottom: 0; }
.forge3d-thought-process summary::-webkit-details-marker { display: none; }
.forge3d-thought-process summary::before { display: inline-block; margin-right: 6px; content: '›'; transition: transform .15s ease; }
.forge3d-thought-process[open] summary::before { transform: rotate(90deg); }
.forge3d-thought-process > span::before { margin-right: 6px; color: var(--acid); content: '✓'; }
:deep(.forge3d-composer-editor) { display: block; min-height: 42px; width: 100%; outline: 0; color: var(--text-primary); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; caret-color: var(--text-primary); cursor: text; }
:deep(.forge3d-composer-editor p) { margin: 0; }
:deep(.forge3d-composer-editor p.is-editor-empty:first-child::before) { float: left; height: 0; color: var(--text-muted); content: 'Describe a 3D canvas or ask for a change…'; pointer-events: none; }
@keyframes thinking-ellipsis { to { clip-path: inset(0 0 0 0); } }
</style>
