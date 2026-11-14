import type { ComponentProps } from 'preact';

const icon = (path: string) =>
  function Icon(props: ComponentProps<'svg'>) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        {...props}
      >
        <path d={path} />
      </svg>
    );
  };

export const BackIcon = icon('M15 5l-7 7 7 7');
export const CloseIcon = icon('M6 6l12 12M18 6L6 18');
export const SearchIcon = icon('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4');
export const SettingsIcon = icon(
  'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
);
export const ScanIcon = icon('M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 12h8M8 15h5');
export const ImageIcon = icon('M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01');
export const ShareIcon = icon('M12 15V4M8 8l4-4 4 4M5 13v6h14v-6');
export const DownloadIcon = icon('M12 4v11M8 11l4 4 4-4M5 19h14');
export const TrashIcon = icon('M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13');
export const EditIcon = icon('M4 20h4l11-11-4-4L4 16zM13 7l4 4');
export const CloudDoneIcon = icon('M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.500 4.500 0 0 1 .500 9zM9 13l2 2 4-4');
export const CloudUpIcon = icon('M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.500 4.500 0 0 1 .500 9zM12 16v-5M9.500 13l2.500-2.500 2.500 2.500');
export const CropIcon = icon('M7 3v14h14M3 7h14v14');
export const SparkleIcon = icon('M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z');
export const PlusIcon = icon('M12 5v14M5 12h14');
export const CheckIcon = icon('M5 12l5 5 9-10');
export const TextIcon = icon('M5 6h14M5 10h14M5 14h10M5 18h7');
export const FlashIcon = icon('M13 3L5 14h6l-1 7 8-11h-6z');
