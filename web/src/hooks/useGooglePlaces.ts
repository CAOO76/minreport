import { useState, useEffect, useCallback, useRef } from 'react';

// === Minimal typings for what we need from google.maps.places ===
declare global {
    interface Window {
        google: any;
        __googleMapsCallback?: () => void;
    }
}

export interface PlacePrediction {
    description: string;
    place_id: string;
    structured_formatting: {
        main_text: string;
        secondary_text: string;
    };
}

export interface AddressComponent {
    long_name: string;
    short_name: string;
    types: string[];
}

export interface PlaceDetails {
    address_components?: AddressComponent[];
    formatted_address?: string;
    geometry?: {
        location: {
            lat: () => number;
            lng: () => number;
        };
    };
    name?: string;
    place_id?: string;
}

export interface GooglePlacesResult {
    isLoaded: boolean;
    loadError: string | null;
    getPredictions: (input: string) => Promise<PlacePrediction[]>;
    getPlaceDetails: (placeId: string) => Promise<PlaceDetails | null>;
}

// Global state to manage script loading across all hook instances
let scriptLoaded = false;
let loadError: string | null = null;
let scriptPromise: Promise<void> | null = null;

export const useGooglePlaces = (apiKey: string | undefined): GooglePlacesResult => {
    const [isLoaded, setIsLoaded] = useState(scriptLoaded);
    const [error, setError] = useState<string | null>(loadError);
    const [libLoaded, setLibLoaded] = useState(false);

    const autocompleteSuggestionRef = useRef<any>(null);
    const placeRef = useRef<any>(null);
    const sessionToken = useRef<any>(null);

    useEffect(() => {
        if (!apiKey) {
            setError('Missing API Key');
            return;
        }

        if (scriptLoaded) {
            setIsLoaded(true);
            return;
        }

        if (!scriptPromise) {
            scriptPromise = new Promise((resolve, reject) => {
                // Check if script is already in document
                if (document.getElementById('google-maps-api-script')) {
                    if (window.google?.maps?.places) {
                        scriptLoaded = true;
                        resolve();
                        return;
                    }
                }

                // Global callback for Google Maps JSONP
                window.__googleMapsCallback = () => {
                    console.log('[GoogleMaps] Script and libraries loaded via callback');
                    if (window.google?.maps?.places) {
                        scriptLoaded = true;
                        resolve();
                    } else {
                        console.error('[GoogleMaps] callback called but window.google.maps.places is missing');
                        loadError = 'Google Maps Places library not found';
                        reject(new Error('Places library missing'));
                    }
                    delete window.__googleMapsCallback;
                };

                const script = document.createElement('script');
                script.id = 'google-maps-api-script';

                // Modern Inline Bootstrap Loader (v=beta for Places New or weekly)
                // This resolves the [loading=async] performance warning and is the modern way to load the SDK.
                const loader = `
                    (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps."+c+"apis.com/maps/api/js?"+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?(console.warn(p+" only loads once. Ignoring:",g)):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
                        key: "${apiKey.trim()}",
                        v: "weekly"
                    });
                `;

                script.textContent = loader;
                script.onerror = (e) => {
                    console.error('[GoogleMaps] Loader injection failed', e);
                    loadError = 'Error injecting Google Maps loader';
                    reject(e);
                };

                // With the loader, we still need to wait for it to be ready
                // but we use importLibrary instead of a global callback for the initial load.
                document.head.appendChild(script);

                // We'll consider the "script" loaded once the loader is in place.
                scriptLoaded = true;
                resolve();
            });
        }

        scriptPromise
            .then(() => {
                // With the bootstrap loader, we simply resolve that the loader script is in place.
                setIsLoaded(true);
                setError(null);
            })
            .catch((err) => {
                setError('Failed to initialize Google Maps Loader');
                console.error('[GoogleMaps] Loader error', err);
            });
    }, [apiKey]);

    // Initialize new API libraries once script is loaded
    useEffect(() => {
        if (isLoaded && window.google?.maps?.importLibrary) {
            const initLib = async () => {
                try {
                    // Using modern importLibrary
                    const { AutocompleteSessionToken, AutocompleteSuggestion, Place } = await window.google.maps.importLibrary('places');

                    if (!sessionToken.current) {
                        sessionToken.current = new AutocompleteSessionToken();
                    }

                    autocompleteSuggestionRef.current = AutocompleteSuggestion;
                    placeRef.current = Place;
                    setLibLoaded(true);
                } catch (e: any) {
                    console.error('[GoogleMaps] Error initializing Places (New) library', e);
                    if (e.message?.includes('denied') || e.message?.includes('permission')) {
                        setError('API_KEY_DENIED: La llave no tiene permisos para Places API (New).');
                    } else {
                        setError('Places library failed to load');
                    }
                }
            };
            initLib();
        }
    }, [isLoaded]);

    const getPredictions = useCallback(async (input: string): Promise<PlacePrediction[]> => {
        if (!isLoaded || !libLoaded || !autocompleteSuggestionRef.current || !input.trim()) {
            return [];
        }

        try {
            const { suggestions } = await autocompleteSuggestionRef.current.fetchAutocompleteSuggestions({
                input: input.trim(),
                sessionToken: sessionToken.current,
                language: 'es',
                region: 'cl' // Optimization for Chile
            });

            if (!suggestions) return [];

            // Map new AutocompleteSuggestion UI format to existing PlacePrediction interface
            return suggestions.map((s: any) => ({
                description: s.placePrediction.text.text,
                place_id: s.placePrediction.placeId,
                structured_formatting: {
                    main_text: s.placePrediction.mainText.text,
                    secondary_text: s.placePrediction.secondaryText?.text || ''
                }
            }));
        } catch (e: any) {
            console.error('[GoogleMaps] fetchAutocompleteSuggestions error', e);
            if (e.name === 'QuotaExceededError') {
                setError('QUOTA_EXCEEDED: Se ha superado el límite de consultas de Google Maps.');
            } else if (e.message?.includes('denied') || e.message?.includes('permission')) {
                setError('API_KEY_DENIED: La llave no tiene permisos para Places API (New).');
            }
            return [];
        }
    }, [isLoaded, libLoaded]);

    const getPlaceDetails = useCallback(async (placeId: string): Promise<PlaceDetails | null> => {
        if (!isLoaded || !libLoaded || !placeRef.current || !placeId) return null;

        try {
            const place = new placeRef.current({
                id: placeId,
                requestedLanguage: 'es'
            });

            // Using modern fetchFields
            await place.fetchFields({
                fields: ['addressComponents', 'formattedAddress', 'location', 'displayName'],
                sessionToken: sessionToken.current
            });

            // Reset session token for next billing cycle
            if (window.google?.maps?.places?.AutocompleteSessionToken) {
                sessionToken.current = new window.google.maps.places.AutocompleteSessionToken();
            }

            // Map new Place (v1) format to existing PlaceDetails interface
            return {
                address_components: place.addressComponents?.map((c: any) => ({
                    long_name: c.longText,
                    short_name: c.shortText,
                    types: c.types
                })),
                formatted_address: place.formattedAddress,
                geometry: {
                    location: {
                        lat: () => place.location.lat(),
                        lng: () => place.location.lng()
                    }
                },
                name: place.displayName,
                place_id: placeId
            };
        } catch (e) {
            console.error('[GoogleMaps] fetchFields error', e);
            return null;
        }
    }, [isLoaded, libLoaded]);

    return {
        isLoaded,
        loadError: error,
        getPredictions,
        getPlaceDetails,
    };
};
