import { useEffect, useMemo, useState } from 'react';
import client from '../services/apiClient';

const sanitizeValues = values => {
  const sanitized = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) {
      sanitized[key] = value;
    }
  });
  return sanitized;
};

const FunctionCard = ({
  title,
  description,
  method = 'GET',
  endpoint,
  fields = [],
  buildRequest,
  icon
}) => {
  const initialValues = useMemo(
    () =>
      fields.reduce((acc, field) => {
        acc[field.name] = field.defaultValue ?? '';
        return acc;
      }, {}),
    [fields]
  );

  const [values, setValues] = useState(initialValues);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async event => {
    event.preventDefault();
    setIsLoading(true);
    setError('');
    setResponse(null);

    try {
      const cleanedValues = sanitizeValues(values);
      const requestOverrides = buildRequest ? buildRequest(cleanedValues, values) : {};

      const requestConfig = {
        method,
        url: endpoint,
        ...requestOverrides
      };

      const verb = (requestConfig.method || method || 'GET').toUpperCase();
      requestConfig.method = verb;

      if (verb === 'GET') {
        requestConfig.params = requestConfig.params ?? cleanedValues;
      } else {
        requestConfig.data = requestConfig.data ?? cleanedValues;
      }

      const { data } = await client(requestConfig);
      setResponse(data);
    } catch (requestError) {
      const detail =
        requestError?.response?.data?.detail ||
        requestError?.response?.data?.error ||
        requestError?.message ||
        'Unable to complete request';
      setError(detail);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setValues(initialValues);
    setResponse(null);
    setError('');
  };

  const renderField = field => {
    const commonProps = {
      id: `${title}-${field.name}`,
      value: values[field.name],
      onChange: event => handleChange(field.name, event.target.value),
      placeholder: field.placeholder,
      required: field.required,
      className:
        'mt-2 w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition',
      name: field.name
    };

    if (field.options?.length) {
      return (
        <select {...commonProps} className={`${commonProps.className} cursor-pointer`}>
          {field.options.map(option => (
            <option key={option.value} value={option.value} className="bg-slate-900 text-white">
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === 'textarea') {
      return <textarea {...commonProps} rows={field.rows || 3} />;
    }

    return <input {...commonProps} type={field.type || 'text'} />;
  };

  const formattedResponse =
    typeof response === 'string' ? response : response ? JSON.stringify(response, null, 2) : '';

  return (
    <form onSubmit={handleSubmit} className="glass-panel p-6 space-y-6 border border-white/5 hover:border-white/10 transition">
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          {icon && <div className="text-2xl">{icon}</div>}
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {description && <p className="text-sm text-white/60 mt-1">{description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-2 py-1 rounded-md font-mono ${
            method === 'GET' ? 'bg-blue-500/20 text-blue-300' :
            method === 'POST' ? 'bg-green-500/20 text-green-300' :
            'bg-purple-500/20 text-purple-300'
          }`}>{method}</span>
          <span className="text-white/40 font-mono">{endpoint}</span>
        </div>
      </div>

      {fields.length > 0 && (
        <div className="space-y-4">
          {fields.map(field => (
            <label key={field.name} className="block">
              <span className="text-sm font-medium text-white/80">{field.label}</span>
              {field.required && <span className="text-red-400 ml-1">*</span>}
              {renderField(field)}
              {field.helper && <p className="text-xs text-white/50 mt-1.5">{field.helper}</p>}
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing...
            </span>
          ) : (
            'Submit Request'
          )}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-xl border border-white/20 px-6 py-3 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white transition"
        >
          Reset
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-300 mb-1">Request Failed</p>
            <p className="text-sm text-red-200">{error}</p>
          </div>
        </div>
      )}

      {formattedResponse && (
        <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">✅</span>
            <p className="text-sm font-semibold text-green-300">Success</p>
          </div>
          <pre className="max-h-60 overflow-auto rounded-lg bg-black/30 p-4 text-xs text-white/80 font-mono">
            {formattedResponse}
          </pre>
        </div>
      )}
    </form>
  );
};

export default FunctionCard;
