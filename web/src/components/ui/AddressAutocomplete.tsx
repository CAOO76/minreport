import { useState } from "react";
import clsx from "clsx";

interface AddressData {
    address: string;
}

interface AddressAutocompleteProps {
    onAddressSelect: (data: AddressData) => void;
    placeholder?: string;
    className?: string;
}

export const AddressAutocomplete = ({
    onAddressSelect,
    placeholder = "Enter address...",
    className,
}: AddressAutocompleteProps) => {
    const [inputValue, setInputValue] = useState("");
    const [isConfirmed, setIsConfirmed] = useState(false);

    const handleConfirm = () => {
        if (inputValue.trim()) {
            onAddressSelect({ address: inputValue.trim() });
            setIsConfirmed(true);
        }
    };

    const handleEdit = () => {
        setIsConfirmed(false);
    };

    if (isConfirmed) {
        return (
            <div className="w-full bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-4 flex items-center gap-3">
                <span className="material-symbols-rounded text-green-600 text-3xl">
                    check_circle
                </span>
                <div className="flex-1">
                    <div className="font-semibold text-green-700 dark:text-green-200">
                        Address confirmed
                    </div>
                    <div className="text-green-900 dark:text-green-100 text-sm break-words">
                        {inputValue}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleEdit}
                    className="ml-2 px-2 py-1 text-xs rounded bg-white dark:bg-green-800 border border-green-300 dark:border-green-600 text-green-700 dark:text-green-100 hover:bg-green-100 dark:hover:bg-green-700 transition"
                >
                    Edit
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={placeholder}
                className={clsx(
                    "w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700",
                    "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all",
                    "text-slate-900 dark:text-slate-100 placeholder-slate-400",
                    className
                )}
            />
            <button
                onClick={handleConfirm}
                className="w-full px-4 py-2 rounded-md bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                disabled={!inputValue.trim()}
            >
                Confirm Address
            </button>
        </div>
    );
};

