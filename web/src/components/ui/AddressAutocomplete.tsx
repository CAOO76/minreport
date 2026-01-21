import usePlacesAutocomplete, {
    getGeocode,
    getLatLng,
} from "use-places-autocomplete";
import {
    Combobox,
    ComboboxInput,
    ComboboxPopover,
    ComboboxList,
    ComboboxOption,
} from "@reach/combobox";
import "@reach/combobox/styles.css";
import clsx from "clsx";

interface AddressData {
    address: string;
    lat: number;
    lng: number;
    city: string;
    country: string;
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
    const {
        ready,
        value,
        suggestions: { status, data },
        setValue,
        clearSuggestions,
    } = usePlacesAutocomplete({
        requestOptions: {
            /* Define search scope here */
        },
        debounce: 300,
    });

    const handleSelect = async (address: string) => {
        setValue(address, false);
        clearSuggestions();

        try {
            const results = await getGeocode({ address });
            const { lat, lng } = await getLatLng(results[0]);

            const addressComponents = results[0].address_components;
            let city = "";
            let country = "";

            addressComponents.forEach((component) => {
                if (component.types.includes("locality")) {
                    city = component.long_name;
                }
                if (component.types.includes("country")) {
                    country = component.long_name;
                }
            });

            onAddressSelect({
                address,
                lat,
                lng,
                city,
                country,
            });
        } catch (error) {
            console.error("Error geocoding address:", error);
        }
    };

    return (
        <Combobox onSelect={handleSelect} className={className}>
            <ComboboxInput
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={!ready}
                placeholder={placeholder}
                autoComplete="off"
                className={clsx(
                    "w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700",
                    "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all",
                    "text-slate-900 dark:text-slate-100 placeholder-slate-400"
                )}
            />
            <ComboboxPopover className="z-50 bg-white dark:bg-surface-card-dark border border-gray-200 dark:border-gray-700 rounded-md shadow-lg mt-1">
                <ComboboxList>
                    {status === "OK" &&
                        data.map(({ place_id, description }) => (
                            <ComboboxOption
                                key={place_id}
                                value={description}
                                className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer text-sm text-slate-700 dark:text-slate-300"
                            />
                        ))}
                </ComboboxList>
            </ComboboxPopover>
        </Combobox>
    );
};
