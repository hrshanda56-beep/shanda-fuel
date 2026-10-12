'use client';

import { useState } from 'react';

import { Checkbox } from '@/design-system/forms';
import { Button, Field, StatusBadge } from '@/design-system/primitives';

import type { SetupOverview, SetupShiftTemplate } from '../contracts';
import { FORECOURT_COMMANDS, sendCommand } from './setup-api';
import { FormModal, NotEntered, Row, RowList, SetupSection, text } from './setup-ui';

function describe(template: SetupShiftTemplate): string {
  const hours = template.durationMinutes / 60;
  const length = Number.isInteger(hours) ? `${hours} h` : `${template.durationMinutes} min`;
  return template.startTime ? `${template.startTime} · ${length}` : `${length}, no fixed start`;
}

export function ShiftsSection({ data, reload }: { data: SetupOverview; reload: () => void }) {
  const [editing, setEditing] = useState<SetupShiftTemplate | 'new' | null>(null);
  // A stable id for a new template so a retried submit cannot create two.
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  if (data.shiftTemplates === null) return null;
  const canManage = data.capabilities.shiftTemplates;
  const target = editing && editing !== 'new' ? editing : null;

  return (
    <SetupSection
      id="setup-shifts"
      title="Shift templates"
      note="How long each shift runs at this station. Starting a shift uses these; nothing is assumed."
      action={
        canManage ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
            Add shift
          </Button>
        ) : undefined
      }
    >
      {data.shiftTemplates.length === 0 ? (
        <NotEntered
          what="shift template"
          hint="No shift template is entered, so shifts cannot be planned."
        />
      ) : (
        <RowList label="Shift templates">
          {data.shiftTemplates.map((template) => (
            <Row
              key={template.id}
              title={template.name}
              badge={
                <StatusBadge tone={template.active ? 'positive' : 'neutral'}>
                  {template.active ? 'Active' : 'Inactive'}
                </StatusBadge>
              }
              details={[
                { label: 'Code', value: template.code },
                { label: 'Schedule', value: describe(template) },
              ]}
              onOpen={canManage ? () => setEditing(template) : undefined}
              openLabel={`Edit shift ${template.name}`}
            />
          ))}
        </RowList>
      )}
      <FormModal
        key={target?.id ?? 'new'}
        open={editing !== null}
        title={target ? 'Edit shift' : 'Add shift'}
        description="Start time is optional. A station that has been activated with a clock schedule cannot be changed here."
        submitLabel={target ? 'Save shift' : 'Add shift'}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          setNewId(crypto.randomUUID());
          reload();
        }}
        onSubmit={(form, key) =>
          sendCommand(
            FORECOURT_COMMANDS,
            {
              commandType: 'DefineShiftTemplate',
              tenantId: data.tenantId,
              stationId: data.stationId,
              shiftTemplateId: target ? target.id : newId,
              expectedVersion: target ? target.version : 0,
              code: text(form, 'code'),
              name: text(form, 'name'),
              ...(text(form, 'start') ? { startTime: text(form, 'start') } : {}),
              durationMinutes: Number(text(form, 'minutes')),
              active: form.get('active') === 'on',
            },
            key,
          )
        }
      >
        <Field id="shift-name" label="Name" required>
          <input id="shift-name" name="name" defaultValue={target?.name} autoComplete="off" />
        </Field>
        <Field id="shift-code" label="Code" required>
          <input id="shift-code" name="code" defaultValue={target?.code} autoComplete="off" />
        </Field>
        <Field id="shift-start" label="Start time, optional">
          <input id="shift-start" name="start" type="time" defaultValue={target?.startTime ?? ''} />
        </Field>
        <Field id="shift-minutes" label="Length (minutes)" required>
          <input
            id="shift-minutes"
            name="minutes"
            inputMode="numeric"
            pattern="[0-9]+"
            defaultValue={target?.durationMinutes}
            autoComplete="off"
          />
        </Field>
        <Checkbox label="Active" name="active" defaultChecked={target ? target.active : true} />
      </FormModal>
    </SetupSection>
  );
}
