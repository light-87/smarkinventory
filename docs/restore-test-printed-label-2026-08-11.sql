-- Restore the one label consumed by a live print test, 2026-08-11
--
-- While reproducing the client's "Receive not working — does not give any
-- output for printing" report on production, the Print sheet button was
-- clicked once. It worked: it rendered a real Avery PDF to R2 and, as designed,
-- flipped the queued label to `printed`. That was the only label in the queue.
--
-- Nothing is broken — the label exists and the sheet was produced — but the
-- queue is one entry lighter than the client left it, so the part he assigned
-- would not appear on his next printed sheet. This puts it back.
--
-- Safe to skip: the alternative is to reprint that one label by hand.
-- Run in the Supabase SQL editor on the production project.

-- 1. Confirm exactly one row is about to change, and that it is the test batch.
select id, target_type, target_id, print_status, printed_at, batch_id
from   smark_qr_labels
where  batch_id = 'b77ffccf-5958-4bbe-a14e-9beeae6b1ca6';

-- 2. Put it back in the queue.
begin;

update smark_qr_labels
set    print_status  = 'queued',
       printed_at    = null,
       batch_id      = null,
       label_pdf_url = null
where  batch_id = 'b77ffccf-5958-4bbe-a14e-9beeae6b1ca6';

-- 3. Expect: one queued label (plus any queued since).
select count(*) as queued_labels
from   smark_qr_labels
where  print_status = 'queued';

commit;
