# Prompt queues

On desktop and mobile, **Add to queue** starts an idle agent automatically. Further prompts wait
behind the current turn and run in order without pressing **Run queue**. You can type the next
prompt while the current send finishes.

Choose **Add without starting** to build a paused queue for later. Adding to an existing paused
queue keeps it paused; **Run queue** or **Add and run queue** explicitly starts it. Queued prompts
can be duplicated and reordered before they run. Normal **Send** keeps its existing behavior.
Updated runtimes also preserve pauses made by another client while an automatic addition is in
flight. Retries keep that intent; **Add and run queue** remains an explicit resume action.

To start separate threads, choose **Start in background** from the Start thread composer. On mobile,
hold **Send** to open this action; tapping **Send** starts the thread normally. After the first
prompt is confirmed, the thread continues in the task list and a fresh composer keeps your computer,
project, model, permissions and checkout settings. Failed or unconfirmed sends stay in the current
thread so they can be retried safely. On desktop, **Alt+Enter** starts in the background.

Each queued prompt keeps its attachments, plan mode and turn settings. A paused prompt blocks the
prompts after it until resumed or moved. **Resume first prompt** explicitly releases a paused head;
**Run queue** respects pauses later in the queue. The queue supports up to 50 prompts and is saved
by the runtime across restarts.

Use **Move earlier / Move later**, desktop drag or mobile touch-and-hold to reorder. Pending sends
cannot be reordered until confirmed. If another client changes the queue before a move arrives, the
runtime rejects the stale move and leaves the current order intact.

Duplicate and move requests use the durable client journal on runtimes that advertise queue mutation
recovery. If a duplicate response is lost, retrying after navigation or restart reuses the original
copy ID. Completed duplicate requests allow a subsequent intentional copy. Rejected stale moves do
not block later actions. Older runtimes retain their foreground queue controls; staging requires an
updated runtime.

If a reorder unblocks a prompt but the runtime cannot start it, the new order stays saved and the
queue pauses with a resumable error. The successful reorder is still acknowledged.
