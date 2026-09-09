import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { FormField } from '@/components/shared/form-field';

describe('FormField', () => {
  describe('rendering', () => {
    it('should render label text and children', () => {
      render(
        <FormField label='Email' htmlFor='email'>
          <input id='email' data-testid='child-input' />
        </FormField>,
      );

      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByTestId('child-input')).toBeInTheDocument();
    });

    it('should link label to control via htmlFor', () => {
      render(
        <FormField label='Email' htmlFor='email-field'>
          <input id='email-field' />
        </FormField>,
      );

      const label = screen.getByText('Email');
      expect(label).toHaveAttribute('for', 'email-field');
    });

    it('should expose the form-field data-slot on the root', () => {
      const { container } = render(
        <FormField label='Email' htmlFor='email'>
          <input id='email' />
        </FormField>,
      );

      const root = container.querySelector('[data-slot="form-field"]');
      expect(root).not.toBeNull();
    });
  });

  describe('description', () => {
    it('should render description when provided and no error', () => {
      render(
        <FormField
          label='Email'
          htmlFor='email'
          description='We will not share your email.'
        >
          <input id='email' />
        </FormField>,
      );

      expect(
        screen.getByText('We will not share your email.'),
      ).toBeInTheDocument();
    });

    it('should not render description when not provided', () => {
      const { container } = render(
        <FormField label='Email' htmlFor='email'>
          <input id='email' />
        </FormField>,
      );

      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs).toHaveLength(0);
    });
  });

  describe('error', () => {
    it('should render error with role="alert" when error is present', () => {
      render(
        <FormField label='Email' htmlFor='email' error='Email is required'>
          <input id='email' />
        </FormField>,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Email is required');
    });

    it('should set data-error="true" on the root when error is present', () => {
      const { container } = render(
        <FormField label='Email' htmlFor='email' error='Bad'>
          <input id='email' />
        </FormField>,
      );

      const root = container.querySelector('[data-slot="form-field"]');
      expect(root).toHaveAttribute('data-error', 'true');
    });

    it('should not set data-error when no error is present', () => {
      const { container } = render(
        <FormField label='Email' htmlFor='email'>
          <input id='email' />
        </FormField>,
      );

      const root = container.querySelector('[data-slot="form-field"]');
      expect(root).not.toHaveAttribute('data-error');
    });

    it('should render error instead of description when both are present', () => {
      render(
        <FormField
          label='Email'
          htmlFor='email'
          description='Helper copy here.'
          error='Email is required'
        >
          <input id='email' />
        </FormField>,
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Email is required');
      expect(screen.queryByText('Helper copy here.')).not.toBeInTheDocument();
    });
  });

  describe('className', () => {
    it('should forward className to the root element', () => {
      const { container } = render(
        <FormField label='Email' htmlFor='email' className='custom-class'>
          <input id='email' />
        </FormField>,
      );

      const root = container.querySelector('[data-slot="form-field"]');
      expect(root).toHaveClass('custom-class');
    });
  });
});
