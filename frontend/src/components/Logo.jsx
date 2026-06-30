// src/components/Logo.jsx
export default function Logo({ className, alt = "What's Next AI Logo" }) {
  return (
    <img
      src="/whatsnextai.png"
      alt={alt}
      className={className}
    />
  );
}
