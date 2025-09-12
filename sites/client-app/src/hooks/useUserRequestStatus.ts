import { useState, useEffect } from 'react';
import { auth, db } from '../firebaseConfig';
import { query, collection, where, getDocs } from 'firebase/firestore'; // Corrected import to getDocs
import type { User } from 'firebase/auth';

type RequestStatus = 'pending_review' | 'pending_additional_data' | 'rejected' | 'approved' | null;

interface UserRequestState {
  status: RequestStatus;
  requestId: string | null;
  loading: boolean;
  user: User | null;
}

const useUserRequestStatus = (): UserRequestState => {
  const [userRequestState, setUserRequestState] = useState<UserRequestState>({
    status: null,
    requestId: null,
    loading: true,
    user: null,
  });

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUserRequestState((prevState) => ({ ...prevState, user, loading: true }));
        try {
          const requestsRef = collection(db, 'requests');
          const q = query(requestsRef, where('applicantEmail', '==', user.email));
          const querySnapshot = await getDocs(q); // Use getDocs for queries

          if (!querySnapshot.empty) {
            const requestDoc = querySnapshot.docs[0];
            setUserRequestState({
              status: requestDoc.data().status as RequestStatus,
              requestId: requestDoc.id,
              loading: false,
              user,
            });
          } else {
            setUserRequestState({
              status: null, // No request found for this user
              requestId: null,
              loading: false,
              user,
            });
          }
        } catch (error) {
          console.error('Error fetching user request status:', error);
          setUserRequestState({
            status: null,
            requestId: null,
            loading: false,
            user,
          });
        }
      } else {
        setUserRequestState({
          status: null,
          requestId: null,
          loading: false,
          user: null,
        });
      }
    });

    return () => unsubscribeAuth();
  }, []);

  return userRequestState;
};

export default useUserRequestStatus;
