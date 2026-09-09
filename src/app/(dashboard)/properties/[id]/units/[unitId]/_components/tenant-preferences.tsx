'use client';

/**
 * TenantPreferencesEditor — owner-side form for updating a tenant's
 * preferences from the unit detail page.
 *
 * Surfaces:
 *   - Preferred channel (radio: SMS / Email / Voice / None)
 *   - Language (text input, default 'en')
 *   - Emergency contact (name + phone)
 *   - Parking space (text)
 *   - Pets (array editor — each entry has type, name?, depositPaid?)
 *
 * On save the form posts to `updateTenantPreferencesAction`, which
 * routes through the worker handler with source='owner', confidence=1.0.
 *
 * The badge above the editor reflects the LAST stored
 * `preferences_source`/`preferences_confidence` so the owner can see at
 * a glance whether prefs were captured by the agent (🤖 from chat) or
 * confirmed by them (✓ confirmed).
 */

import * as React from 'react';

import { ConfidenceBadge, type ConfidenceSource } from '@/components/shared';

import { updateTenantPreferencesAction } from '../actions';

export interface TenantPreferencesEditorProps {
  propertyId: string;
  unitId: string;
  tenantId: string;
  tenantName: string;
  initial: {
    preferredChannel: 'sms' | 'email' | 'voice' | 'none' | null;
    language: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    parkingSpace: string | null;
    pets: ReadonlyArray<{
      type: string;
      name: string | null;
      depositPaid: boolean;
    }>;
    confidence: number;
    source: ConfidenceSource;
  };
}

interface PetState {
  id: number;
  type: string;
  name: string;
  depositPaid: boolean;
}

const CHANNEL_OPTIONS: ReadonlyArray<{
  value: 'sms' | 'email' | 'voice' | 'none';
  label: string;
}> = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'voice', label: 'Voice' },
  { value: 'none', label: 'None' },
];

export function TenantPreferencesEditor({
  propertyId,
  unitId,
  tenantId,
  tenantName,
  initial,
}: TenantPreferencesEditorProps): React.ReactElement {
  const [channel, setChannel] = React.useState<'sms' | 'email' | 'voice' | 'none'>(
    initial.preferredChannel ?? 'sms',
  );
  const [language, setLanguage] = React.useState(initial.language ?? 'en');
  const [emergencyName, setEmergencyName] = React.useState(
    initial.emergencyContactName ?? '',
  );
  const [emergencyPhone, setEmergencyPhone] = React.useState(
    initial.emergencyContactPhone ?? '',
  );
  const [parkingSpace, setParkingSpace] = React.useState(
    initial.parkingSpace ?? '',
  );
  const [pets, setPets] = React.useState<PetState[]>(() =>
    initial.pets.map((p, i) => ({
      id: i,
      type: p.type,
      name: p.name ?? '',
      depositPaid: p.depositPaid,
    })),
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  function addPet() {
    setPets((prev) => [
      ...prev,
      {
        id: prev.length === 0 ? 0 : Math.max(...prev.map((p) => p.id)) + 1,
        type: '',
        name: '',
        depositPaid: false,
      },
    ]);
  }

  function removePet(id: number) {
    setPets((prev) => prev.filter((p) => p.id !== id));
  }

  function updatePet(id: number, patch: Partial<PetState>) {
    setPets((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  async function onSave(formData: FormData) {
    setPending(true);
    setError(null);
    // Encode pets as a single JSON field; server action parses + revalidates.
    formData.set(
      'pets',
      JSON.stringify(
        pets
          .filter((p) => p.type.trim().length > 0)
          .map((p) => ({
            type: p.type.trim(),
            name: p.name.trim() || undefined,
            depositPaid: p.depositPaid,
          })),
      ),
    );
    try {
      const result = await updateTenantPreferencesAction(
        { propertyId, unitId, tenantId },
        formData,
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSavedAt(Date.now());
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      data-testid="tenant-preferences"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        marginTop: '24px',
        padding: '20px',
        border: '1px solid var(--ink-200)',
        borderRadius: '8px',
        background: 'var(--paper-0)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <h3
          className="font-serif-display"
          style={{ fontSize: '18px', color: 'var(--ink-900)' }}
        >
          {tenantName}&apos;s preferences
        </h3>
        <ConfidenceBadge
          source={initial.source}
          confidence={initial.confidence}
        />
      </header>

      <form action={onSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Preferred channel</legend>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {CHANNEL_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                }}
              >
                <input
                  type="radio"
                  name="preferredChannel"
                  value={opt.value}
                  checked={channel === opt.value}
                  onChange={() => setChannel(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div style={gridTwoCol}>
          <Field label="Language">
            <input
              name="language"
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={inputStyle}
              placeholder="en"
            />
          </Field>
          <Field label="Parking space">
            <input
              name="parkingSpace"
              type="text"
              value={parkingSpace}
              onChange={(e) => setParkingSpace(e.target.value)}
              style={inputStyle}
              placeholder="12B"
            />
          </Field>
          <Field label="Emergency contact name">
            <input
              name="emergencyContactName"
              type="text"
              value={emergencyName}
              onChange={(e) => setEmergencyName(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Emergency contact phone">
            <input
              name="emergencyContactPhone"
              type="tel"
              value={emergencyPhone}
              onChange={(e) => setEmergencyPhone(e.target.value)}
              style={inputStyle}
              placeholder="+15555550100"
            />
          </Field>
        </div>

        <PetsList
          pets={pets}
          onAdd={addPet}
          onRemove={removePet}
          onUpdate={updatePet}
        />

        {error ? (
          <p role="alert" style={{ color: 'var(--danger, #b91c1c)', fontSize: '13px' }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="submit"
            data-testid="tenant-preferences-save"
            disabled={pending}
            style={submitStyle}
          >
            {pending ? 'Saving…' : 'Save preferences'}
          </button>
          {savedAt !== null ? (
            <span style={{ color: 'var(--ink-500)', fontSize: '12px' }}>
              Saved.
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

interface PetsListProps {
  pets: PetState[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  onUpdate: (id: number, patch: Partial<PetState>) => void;
}

function PetsList({ pets, onAdd, onRemove, onUpdate }: PetsListProps) {
  return (
    <fieldset style={fieldsetStyle} data-testid="pets-list">
      <legend style={legendStyle}>Pets</legend>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {pets.length === 0 ? (
          <p style={{ color: 'var(--ink-500)', fontSize: '13px' }}>
            No pets recorded.
          </p>
        ) : (
          pets.map((pet) => (
            <div
              key={pet.id}
              data-testid="pet-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr auto auto',
                gap: '8px',
                alignItems: 'center',
              }}
            >
              <input
                type="text"
                value={pet.type}
                onChange={(e) => onUpdate(pet.id, { type: e.target.value })}
                placeholder="Type (dog, cat…)"
                style={inputStyle}
              />
              <input
                type="text"
                value={pet.name}
                onChange={(e) => onUpdate(pet.id, { name: e.target.value })}
                placeholder="Name (optional)"
                style={inputStyle}
              />
              <label style={{ display: 'inline-flex', gap: '6px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={pet.depositPaid}
                  onChange={(e) =>
                    onUpdate(pet.id, { depositPaid: e.target.checked })
                  }
                />
                Deposit paid
              </label>
              <button
                type="button"
                onClick={() => onRemove(pet.id)}
                style={iconButtonStyle}
                aria-label="Remove pet"
              >
                ×
              </button>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={onAdd}
          data-testid="pet-add"
          style={{
            ...submitStyle,
            background: 'transparent',
            color: 'var(--ink-900)',
            border: '1px solid var(--ink-200)',
            alignSelf: 'flex-start',
          }}
        >
          + Add pet
        </button>
      </div>
    </fieldset>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '13px',
        color: 'var(--ink-500)',
      }}
    >
      {label}
      {children}
    </label>
  );
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--ink-200)',
  borderRadius: '6px',
  padding: '12px 14px',
};

const legendStyle: React.CSSProperties = {
  padding: '0 6px',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--ink-500)',
};

const gridTwoCol: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '12px',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--ink-200)',
  borderRadius: '6px',
  background: 'var(--paper-0)',
  fontSize: '14px',
  color: 'var(--ink-900)',
};

const submitStyle: React.CSSProperties = {
  padding: '8px 14px',
  border: '1px solid var(--ink-900)',
  borderRadius: '6px',
  background: 'var(--ink-900)',
  color: 'var(--paper-0)',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
};

const iconButtonStyle: React.CSSProperties = {
  width: '28px',
  height: '28px',
  border: '1px solid var(--ink-200)',
  borderRadius: '6px',
  background: 'transparent',
  color: 'var(--ink-500)',
  cursor: 'pointer',
  fontSize: '16px',
  lineHeight: 1,
};
